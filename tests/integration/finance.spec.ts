import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { expenses, notifications, reimbursements } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { archiveExpense, recordExpense, InvalidAmountError } from "../../application/commands/finance/recordExpense";
import {
  createReimbursement,
  linkExpensesToReimbursement,
  transitionReimbursement,
  ExpenseLinkError,
  IllegalReimbursementTransitionError,
} from "../../application/commands/finance/reimbursementCommands";
import { setBudget } from "../../application/commands/finance/setBudget";
import {
  getClaimableExpenses,
  getExpensesForMonth,
  getFinanceOverview,
  getReimbursement,
  getReimbursements,
} from "../../application/queries/finance/getFinance";
import { getAttention } from "../../application/queries/attention/getAttention";
import { scanForReminders } from "../../application/reminders/scanForReminders";
import { processOutbox } from "../../application/outbox/processOutbox";
import { AuthorizationError, ConflictError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * Phase 5 against a real database: expenses, budget envelopes, the
 * reimbursement lifecycle, and the authorization boundary that keeps a
 * child account out of the household's finances.
 *
 * Requires DATABASE_URL to point at a disposable development database.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor, personId: person.id };
}

const MARCH = "2026-03";
const IN_MARCH = "2026-03-12";

async function anExpense(actor: Actor, householdId: string, overrides: Record<string, unknown> = {}) {
  return recordExpense(actor, householdId, {
    description: "Physio session",
    amount: "60,00",
    category: "HEALTH",
    incurredOn: IN_MARCH,
    ...overrides,
  });
}

describe("recording expenses", () => {
  it("stores the amount in minor units, parsed from what was typed", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId, { amount: "1.234,56" });

    expect(expense.amountMinor).toBe(123456);
    expect(expense.currency).toBe("EUR");
  });

  // ADR-015 §4: this is the one aggregate that defaults to SENSITIVE, and
  // the default must not be overridable from a call site.
  it("makes every expense SENSITIVE without the caller asking", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    expect(expense.sensitivity).toBe("SENSITIVE");
  });

  it("refuses an amount it cannot read rather than guessing", async () => {
    const { householdId, actor } = await household();
    await expect(anExpense(actor, householdId, { amount: "sixty euros" })).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it("refuses a negative expense instead of storing a refund by sign", async () => {
    const { householdId, actor } = await household();
    await expect(anExpense(actor, householdId, { amount: "-60,00" })).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it("keeps an archived expense out of the month but not out of the record", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);

    await archiveExpense(actor, householdId, expense.id, expense.version);

    expect(await getExpensesForMonth(actor, householdId, MARCH)).toHaveLength(0);
    const [row] = await db.select().from(expenses).where(eq(expenses.id, expense.id));
    expect(row.archivedAt).not.toBeNull();
  });

  it("refuses a stale archive rather than overwriting a concurrent edit", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    await archiveExpense(actor, householdId, expense.id, expense.version);

    await expect(archiveExpense(actor, householdId, expense.id, expense.version)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("budgets", () => {
  it("reports spend against the envelope for the month", async () => {
    const { householdId, actor } = await household();
    await setBudget(actor, householdId, { category: "HEALTH", amount: "200,00", startsOn: "2026-01-01" });
    await anExpense(actor, householdId, { amount: "60,00" });
    await anExpense(actor, householdId, { amount: "120,00", description: "Orthotics" });

    const overview = await getFinanceOverview(actor, householdId, MARCH);
    const health = overview.budgets.find((b) => b.category === "HEALTH");

    expect(health).toMatchObject({ limitMinor: 20_000, spentMinor: 18_000, remainingMinor: 2_000, health: "NEAR" });
    expect(overview.totals).toEqual([{ currency: "EUR", totalMinor: 18_000 }]);
  });

  // ADR-015 §5: changing a limit must not retroactively rewrite a month
  // that has already been reported on.
  it("ends the old envelope and starts a new one rather than editing in place", async () => {
    const { householdId, actor } = await household();
    await setBudget(actor, householdId, { category: "GROCERIES", amount: "400,00", startsOn: "2026-01-01" });
    await setBudget(actor, householdId, { category: "GROCERIES", amount: "450,00", startsOn: "2026-03-01" });

    const february = await getFinanceOverview(actor, householdId, "2026-02");
    const march = await getFinanceOverview(actor, householdId, MARCH);

    expect(february.budgets.find((b) => b.category === "GROCERIES")?.limitMinor).toBe(40_000);
    expect(march.budgets.find((b) => b.category === "GROCERIES")?.limitMinor).toBe(45_000);
  });

  it("does not count spend from another currency towards an envelope", async () => {
    const { householdId, actor } = await household();
    await setBudget(actor, householdId, { category: "TRAVEL", amount: "500,00", startsOn: "2026-01-01" });
    await anExpense(actor, householdId, { category: "TRAVEL", amount: "300,00", currency: "CHF" });

    const overview = await getFinanceOverview(actor, householdId, MARCH);
    expect(overview.budgets.find((b) => b.category === "TRAVEL")?.spentMinor).toBe(0);
    // Said out loud rather than silently dropped.
    expect(overview.uncoveredCurrencies).toEqual(["CHF"]);
  });
});

describe("the reimbursement lifecycle", () => {
  async function submittedClaim() {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    const claim = await createReimbursement(actor, householdId, {
      title: "Physio, March",
      expenseIds: [expense.id],
    });
    const submitted = await transitionReimbursement(actor, householdId, claim.id, claim.version, {
      type: "SUBMIT",
      counterparty: "Krankenkasse",
    });
    return { householdId, actor, expense, claim: submitted };
  }

  it("derives the claimed amount from the attached expenses", async () => {
    const { householdId, actor } = await household();
    const a = await anExpense(actor, householdId, { amount: "60,00" });
    const b = await anExpense(actor, householdId, { amount: "25,50", description: "Bandage" });

    const claim = await createReimbursement(actor, householdId, {
      title: "Physio, March",
      expenseIds: [a.id, b.id],
    });

    expect(claim.claimedAmountMinor).toBe(8_550);
  });

  it("will not submit a claim with nothing attached", async () => {
    const { householdId, actor } = await household();
    const claim = await createReimbursement(actor, householdId, { title: "Something, eventually" });

    await expect(
      transitionReimbursement(actor, householdId, claim.id, claim.version, {
        type: "SUBMIT",
        counterparty: "Krankenkasse",
      })
    ).rejects.toMatchObject({ code: "NOTHING_TO_CLAIM" });
  });

  it("refuses an expense in a different currency instead of converting it", async () => {
    const { householdId, actor } = await household();
    const foreign = await anExpense(actor, householdId, { currency: "CHF" });
    const claim = await createReimbursement(actor, householdId, { title: "Physio, March" });

    await expect(linkExpensesToReimbursement(actor, householdId, claim.id, [foreign.id])).rejects.toMatchObject({
      code: "CURRENCY_MISMATCH",
    });
  });

  it("refuses to put one expense on two claims", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    await createReimbursement(actor, householdId, { title: "First claim", expenseIds: [expense.id] });
    const second = await createReimbursement(actor, householdId, { title: "Second claim" });

    await expect(linkExpensesToReimbursement(actor, householdId, second.id, [expense.id])).rejects.toBeInstanceOf(
      ExpenseLinkError
    );
  });

  // An id naming nothing in this household must not be quietly skipped —
  // that is the shape an IDOR probe takes.
  it("refuses an expense id from outside the household", async () => {
    const { householdId, actor } = await household();
    const claim = await createReimbursement(actor, householdId, { title: "Physio, March" });

    await expect(
      linkExpensesToReimbursement(actor, householdId, claim.id, ["00000000-0000-7000-8000-000000000000"])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("will not change what is being claimed once the claim has been lodged", async () => {
    const { householdId, actor, claim } = await submittedClaim();
    const another = await anExpense(actor, householdId, { description: "Second session" });

    await expect(linkExpensesToReimbursement(actor, householdId, claim.id, [another.id])).rejects.toMatchObject({
      code: "CLAIM_NOT_EDITABLE",
    });
  });

  it("walks the documented path to COMPLETED and records each step on the timeline", async () => {
    const { householdId, actor, claim } = await submittedClaim();

    const waiting = await transitionReimbursement(actor, householdId, claim.id, claim.version, {
      type: "WAIT",
      followUpAt: new Date("2026-04-01T09:00:00Z"),
    });
    const approved = await transitionReimbursement(actor, householdId, claim.id, waiting.version, { type: "APPROVE" });
    const paid = await transitionReimbursement(actor, householdId, claim.id, approved.version, {
      type: "RECORD_FULL_PAYMENT",
      reimbursedAmountMinor: 6_000,
    });
    const completed = await transitionReimbursement(actor, householdId, claim.id, paid.version, { type: "COMPLETE" });

    expect(completed.status).toBe("COMPLETED");

    const detail = await getReimbursement(actor, householdId, claim.id);
    expect(detail.timeline.map((e) => e.type)).toContain("STATUS_CHANGED");
    expect(detail.timeline.length).toBeGreaterThanOrEqual(5);
    expect(detail.outstandingMinor).toBe(0);
  });

  it("rejects an illegal transition with the domain's own reason", async () => {
    const { householdId, actor, claim } = await submittedClaim();

    await expect(
      transitionReimbursement(actor, householdId, claim.id, claim.version, { type: "APPROVE" })
    ).rejects.toBeInstanceOf(IllegalReimbursementTransitionError);
  });

  it("refuses a stale version rather than overwriting a concurrent change", async () => {
    const { householdId, actor, claim } = await submittedClaim();
    await transitionReimbursement(actor, householdId, claim.id, claim.version, {
      type: "WAIT",
      followUpAt: new Date("2026-04-01T09:00:00Z"),
    });

    await expect(
      transitionReimbursement(actor, householdId, claim.id, claim.version, { type: "CANCEL" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("stops offering a claimed expense as claimable", async () => {
    const { householdId, actor, expense } = await submittedClaim();
    const claimable = await getClaimableExpenses(actor, householdId);
    expect(claimable.map((e) => e.id)).not.toContain(expense.id);
  });
});

describe("an unresolved claim reaches the household", () => {
  // product-spec.md lists "unresolved reimbursement" as an attention
  // trigger; ADR-015 satisfies it by reusing the existing waiting rules
  // rather than adding a rule.
  it("surfaces a claim whose follow-up date has passed, with the reason why", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    const claim = await createReimbursement(actor, householdId, {
      title: "Physio, March",
      expenseIds: [expense.id],
    });
    const submitted = await transitionReimbursement(actor, householdId, claim.id, claim.version, {
      type: "SUBMIT",
      counterparty: "Krankenkasse",
    });
    await transitionReimbursement(actor, householdId, claim.id, submitted.version, {
      type: "WAIT",
      followUpAt: new Date("2026-03-01T09:00:00Z"),
    });

    const { items } = await getAttention(actor, householdId, new Date("2026-03-20T09:00:00Z"));
    const surfaced = items.find((item) => item.id === claim.id);

    expect(surfaced?.kind).toBe("reimbursement");
    expect(surfaced?.reasons.map((r) => r.code)).toContain("FOLLOW_UP_DUE");
  });

  it("notifies once when the chase date arrives, and not again on a rescan", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    const claim = await createReimbursement(actor, householdId, {
      title: "Physio, March",
      expenseIds: [expense.id],
    });
    const submitted = await transitionReimbursement(actor, householdId, claim.id, claim.version, {
      type: "SUBMIT",
      counterparty: "Krankenkasse",
    });
    await transitionReimbursement(actor, householdId, claim.id, submitted.version, {
      type: "WAIT",
      followUpAt: new Date("2026-03-01T09:00:00Z"),
    });

    const first = await scanForReminders(new Date("2026-03-20T09:00:00Z"));
    expect(first.reimbursementFollowUps).toBe(1);

    const second = await scanForReminders(new Date("2026-03-21T09:00:00Z"));
    expect(second.reimbursementFollowUps).toBe(0);

    await processOutbox(10);
    const rows = await db.select().from(notifications).where(eq(notifications.householdId, householdId));
    expect(rows).toHaveLength(1);
    // The notification carries no amount — CLAUDE.md §12.
    expect(rows[0].title).toBe("Physio, March");
    expect(JSON.stringify(rows[0])).not.toContain("6000");
  });
});

describe("who may see the household's money", () => {
  async function childActor(householdId: string, ownerActor: Actor) {
    const person = await addHouseholdMember(ownerActor, householdId, {
      displayName: "Kid",
      role: "CHILD",
      account: { email: "kid@example.test", temporaryPassword: "another correct horse battery" },
    });
    return {
      actor: {
        userId: person.accountUserId!,
        householdId,
        role: "CHILD",
        personIds: [person.id],
      } as Actor,
      personId: person.id,
    };
  }

  // Expenses default to SENSITIVE and canAccess refuses a CHILD anything
  // above NORMAL — so this holds without a finance-specific rule, which is
  // the point of ADR-015 §4.
  it("hides household expenses from a child account", async () => {
    const { householdId, actor } = await household();
    await anExpense(actor, householdId);

    const child = await childActor(householdId, actor);
    expect(await getExpensesForMonth(child.actor, householdId, MARCH)).toEqual([]);
  });

  it("hides an expense that is about the child from the child", async () => {
    const { householdId, actor } = await household();
    const child = await childActor(householdId, actor);
    await anExpense(actor, householdId, { personId: child.personId, description: "School trip" });

    expect(await getExpensesForMonth(child.actor, householdId, MARCH)).toEqual([]);
  });

  it("refuses a child recording an expense at all", async () => {
    const { householdId, actor } = await household();
    const child = await childActor(householdId, actor);

    await expect(anExpense(child.actor, householdId)).rejects.toBeInstanceOf(AuthorizationError);
  });

  /**
   * Changed when the export was built, and worth recording why.
   *
   * This test used to assert that a viewer could *read* expenses. It was
   * encoding what `canAccess` happened to do — the kernel applies a
   * sensitivity ceiling to CHILD only, so a VIEWER passed straight through
   * on any read — rather than what `docs/permissions.md` has always said,
   * which is "Finance | Viewer | none by default".
   *
   * Nothing made the gap visible while a viewer had to go and look at the
   * finance page for themselves. An export is where it stopped being
   * quiet: one file, containing the household's entire financial history,
   * handed to the account somebody was given so they could see the
   * calendar.
   */
  it("gives a viewer no finance at all", async () => {
    const { householdId, actor } = await household();
    await anExpense(actor, householdId);

    const viewer: Actor = { userId: actor.userId, householdId, role: "VIEWER", personIds: [] };
    expect(await getExpensesForMonth(viewer, householdId, MARCH)).toEqual([]);
    await expect(anExpense(viewer, householdId)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses to read a claim from another household", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    const claim = await createReimbursement(actor, householdId, {
      title: "Physio, March",
      expenseIds: [expense.id],
    });

    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };
    await expect(getReimbursement(outsider, householdId, claim.id)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await getReimbursements(outsider, householdId)).toEqual([]);
  });
});

describe("totals never disclose rows the reader cannot see", () => {
  // Summing in SQL would show a scoped reader a category total that
  // includes expenses the same page refuses to list — a disclosure by
  // arithmetic, since the reader can subtract.
  it("sums only the expenses the actor is allowed to read", async () => {
    const { householdId, actor } = await household();
    await setBudget(actor, householdId, { category: "HEALTH", amount: "200,00", startsOn: "2026-01-01" });
    await anExpense(actor, householdId, { amount: "60,00" });

    const viewerSeesAll = await getFinanceOverview(actor, householdId, MARCH);
    expect(viewerSeesAll.budgets.find((b) => b.category === "HEALTH")?.spentMinor).toBe(6_000);

    const { actor: child } = await (async () => {
      const person = await addHouseholdMember(actor, householdId, {
        displayName: "Kid",
        role: "CHILD",
        account: { email: "kid2@example.test", temporaryPassword: "another correct horse battery" },
      });
      return {
        actor: { userId: person.accountUserId!, householdId, role: "CHILD", personIds: [person.id] } as Actor,
      };
    })();

    const childOverview = await getFinanceOverview(child, householdId, MARCH);
    expect(childOverview.expenses).toEqual([]);
    expect(childOverview.totals).toEqual([]);
    // No envelope figures either — a budget is itself SENSITIVE.
    expect(childOverview.budgets).toEqual([]);
  });
});

describe("a claim's stored shape", () => {
  it("never lets an amount go negative, even below the domain", async () => {
    const { householdId, actor } = await household();
    const expense = await anExpense(actor, householdId);
    const claim = await createReimbursement(actor, householdId, {
      title: "Physio, March",
      expenseIds: [expense.id],
    });

    await expect(
      db.update(reimbursements).set({ reimbursedAmountMinor: -1 }).where(eq(reimbursements.id, claim.id))
    ).rejects.toThrow();
  });
});

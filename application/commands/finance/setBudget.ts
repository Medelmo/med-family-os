import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { budgets } from "../../../db/schema";
import { EXPENSE_CATEGORIES } from "../../../domain/finance/expense";
import { DEFAULT_CURRENCY, parseAmountToMinor } from "../../../domain/finance/money";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeBudgetAccess } from "../../policies/finance";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";
import { InvalidAmountError } from "./recordExpense";

const setBudgetSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.string().trim().min(1).max(30),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .default(DEFAULT_CURRENCY),
  /** Which month the envelope starts covering; defaults to the caller's "today". */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type SetBudgetInput = z.input<typeof setBudgetSchema>;

/**
 * Sets the monthly envelope for a category.
 *
 * Replacing an existing envelope *ends the old one and starts a new one*
 * rather than editing the limit in place. ADR-015 §5 is explicit that
 * editing in place would retroactively change months that have already
 * been reported on — "we were under budget in March" must not become false
 * because someone adjusted April's plan. Ending and starting keeps each
 * month's answer stable and is what makes the history readable later.
 *
 * The partial unique index on (household, category, currency) where
 * `ends_on is null` is what makes this safe under concurrency: two
 * simultaneous edits cannot both leave an open envelope behind.
 */
export async function setBudget(actor: Actor, householdId: string, input: SetBudgetInput) {
  const parsed = setBudgetSchema.parse(input);

  const amount = parseAmountToMinor(parsed.amount, parsed.currency);
  if (!amount.ok) throw new InvalidAmountError(`That amount could not be read (${amount.reason}).`);
  if (amount.amountMinor <= 0) throw new InvalidAmountError("A budget must be a positive amount.");

  if (!authorizeBudgetAccess(actor, "update", { householdId })) {
    throw new AuthorizationError("Not permitted to set a budget in this household.");
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          eq(budgets.category, parsed.category),
          eq(budgets.currency, parsed.currency),
          isNull(budgets.endsOn)
        )
      )
      .limit(1);

    if (existing) {
      if (existing.monthlyLimitMinor === amount.amountMinor) return existing;

      // The old envelope ends the day before the new one starts, so no
      // month is covered by both and the projection never has to choose.
      const endsOn = dayBefore(parsed.startsOn);
      // If the replacement would start on or before the old envelope's own
      // start, there is no non-empty period left for the old one; drop it
      // instead of writing a row that violates budget_period_ordered.
      if (endsOn < existing.startsOn) {
        await tx.delete(budgets).where(eq(budgets.id, existing.id));
      } else {
        await tx
          .update(budgets)
          .set({ endsOn, updatedAt: new Date(), version: existing.version + 1 })
          .where(eq(budgets.id, existing.id));
      }
    }

    const [created] = await tx
      .insert(budgets)
      .values({
        householdId,
        category: parsed.category,
        currency: parsed.currency,
        monthlyLimitMinor: amount.amountMinor,
        startsOn: parsed.startsOn,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "budget.set",
        resourceType: "budget",
        resourceId: created.id,
        metadata: { category: parsed.category, currency: parsed.currency },
      },
      tx
    );

    return created;
  });
}

/** Ends an envelope without starting a replacement. */
export async function endBudget(
  actor: Actor,
  householdId: string,
  budgetId: string,
  expectedVersion: number,
  endsOn: string,
  now: Date = new Date()
) {
  if (!authorizeBudgetAccess(actor, "update", { householdId })) {
    throw new AuthorizationError("Not permitted to change a budget in this household.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, budgetId), eq(budgets.householdId, householdId)))
      .limit(1);

    if (!row) throw new NotFoundError("Budget not found.");

    const updated = await tx
      .update(budgets)
      .set({ endsOn, updatedAt: now, version: row.version + 1 })
      .where(and(eq(budgets.id, budgetId), eq(budgets.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This budget was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      { householdId, actorUserId: actor.userId, action: "budget.ended", resourceType: "budget", resourceId: budgetId },
      tx
    );

    return updated[0];
  });
}

/**
 * The calendar day before an ISO date.
 *
 * Safe to do in UTC: both the input and the output are date-only values
 * with no time-of-day meaning, so there is no instant here for a timezone
 * to shift (CLAUDE.md §7).
 */
function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

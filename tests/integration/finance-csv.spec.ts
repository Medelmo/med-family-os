import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { recordExpense } from "../../application/commands/finance/recordExpense";
import { importExpenses, previewExpenseImport } from "../../application/commands/finance/importExpenses";
import { exportExpensesCsv, getExpensesForMonth } from "../../application/queries/finance/getFinance";
import { parseCsv } from "../../domain/finance/csv";
import { AuthorizationError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * CSV import and export against a real database: the review-before-write
 * promise of ADR-015, and the two places a CSV feature leaks — an export
 * that shows more than the page does, and a cell a spreadsheet executes.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

async function household(email = "ada@example.test") {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: email,
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor };
}

async function childOf(actor: Actor, householdId: string, email: string): Promise<Actor> {
  const person = await addHouseholdMember(actor, householdId, {
    displayName: "Kid",
    role: "CHILD",
    account: { email, temporaryPassword: "another correct horse battery" },
  });
  return { userId: person.accountUserId!, householdId, role: "CHILD", personIds: [person.id] };
}

const HEADER = "Date,Description,Amount,Currency,Category,Merchant";
const MARCH = "2026-03";

describe("importing", () => {
  it("writes nothing while previewing", async () => {
    const { householdId, actor } = await household();

    const plan = await previewExpenseImport(actor, householdId, `${HEADER}\n2026-03-12,Physio,60.00,EUR,HEALTH,`);
    expect(plan).toMatchObject({ ok: true, importable: 1 });
    expect(await getExpensesForMonth(actor, householdId, MARCH)).toEqual([]);
  });

  it("imports the rows it said it would, and skips the rest", async () => {
    const { householdId, actor } = await household();
    const csv = [
      HEADER,
      "2026-03-12,Physio,60.00,EUR,HEALTH,",
      "2026-03-13,,25.00,EUR,,",
      "2026-03-14,Broken,not-a-number,EUR,,",
      '12.03.2026,German row,"1.234,56",EUR,HOUSEHOLD,Baumarkt',
    ].join("\n");

    const plan = await previewExpenseImport(actor, householdId, csv);
    expect(plan).toMatchObject({ ok: true, importable: 2, rejected: 2 });

    const result = await importExpenses(actor, householdId, csv);
    expect(result).toEqual({ imported: 2, skipped: 2 });

    const stored = await getExpensesForMonth(actor, householdId, MARCH);
    expect(stored.map((e) => e.description).sort()).toEqual(["German row", "Physio"]);
    expect(stored.find((e) => e.description === "German row")?.amountMinor).toBe(123456);
  });

  it("gives imported rows the same protection as typed ones", async () => {
    const { householdId, actor } = await household();
    await importExpenses(actor, householdId, `${HEADER}\n2026-03-12,Physio,60.00,EUR,HEALTH,`);

    const child = await childOf(actor, householdId, "kid@example.test");
    expect(await getExpensesForMonth(child, householdId, MARCH)).toEqual([]);
  });

  it("refuses a child importing at all", async () => {
    const { householdId, actor } = await household();
    const child = await childOf(actor, householdId, "kid2@example.test");
    const csv = `${HEADER}\n2026-03-12,A,1.00,EUR,,`;

    await expect(previewExpenseImport(child, householdId, csv)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(importExpenses(child, householdId, csv)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("flags a row that already exists but still imports it when asked", async () => {
    const { householdId, actor } = await household();
    const csv = `${HEADER}\n2026-03-12,Physio,60.00,EUR,HEALTH,`;

    await importExpenses(actor, householdId, csv);
    const plan = await previewExpenseImport(actor, householdId, csv);

    expect(plan.ok && plan.rows[0].possibleDuplicate).toBe(true);
    // Two identical coffees on one day are a real thing; the household
    // decides, not the importer.
    await importExpenses(actor, householdId, csv);
    expect(await getExpensesForMonth(actor, householdId, MARCH)).toHaveLength(2);
  });

  it("writes nothing at all when a file has no importable rows", async () => {
    const { householdId, actor } = await household();
    const result = await importExpenses(actor, householdId, `${HEADER}\n2026-03-12,,nope,EUR,,`);
    expect(result).toEqual({ imported: 0, skipped: 1 });
    expect(await getExpensesForMonth(actor, householdId, MARCH)).toEqual([]);
  });
});

describe("exporting", () => {
  it("round-trips through its own importer", async () => {
    const first = await household();
    await recordExpense(first.actor, first.householdId, {
      description: "Physio",
      amount: "60,50",
      category: "HEALTH",
      incurredOn: "2026-03-12",
      merchant: "Praxis",
    });

    const csv = await exportExpensesCsv(first.actor, first.householdId, MARCH);
    await resetDatabase();

    const second = await household();
    const result = await importExpenses(second.actor, second.householdId, csv);
    expect(result.imported).toBe(1);

    const [restored] = await getExpensesForMonth(second.actor, second.householdId, MARCH);
    expect(restored).toMatchObject({
      description: "Physio",
      amountMinor: 6050,
      currency: "EUR",
      category: "HEALTH",
      merchant: "Praxis",
      incurredOn: "2026-03-12",
    });
  });

  // The export leaves the app, and the browser's protections with it. A
  // description like =HYPERLINK(...) executes when the file is opened in a
  // spreadsheet.
  it("neutralises a description a spreadsheet would run as a formula", async () => {
    const { householdId, actor } = await household();
    const dangerous = '=HYPERLINK("https://evil.example","Click")';
    await recordExpense(actor, householdId, {
      description: dangerous,
      amount: "1,00",
      incurredOn: "2026-03-12",
    });

    const csv = await exportExpensesCsv(actor, householdId, MARCH);
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/);

    // Still readable: the quote is a spreadsheet text marker, and the
    // household's own data survives the round trip apart from it.
    const [, row] = parseCsv(csv);
    expect(row[1]).toBe(`'${dangerous}`);
  });

  it("exports only what the actor may read", async () => {
    const { householdId, actor } = await household();
    await recordExpense(actor, householdId, {
      description: "Physio",
      amount: "60,00",
      incurredOn: "2026-03-12",
    });

    const child = await childOf(actor, householdId, "kid3@example.test");

    const ownerCsv = await exportExpensesCsv(actor, householdId, MARCH);
    const childCsv = await exportExpensesCsv(child, householdId, MARCH);

    expect(ownerCsv).toContain("Physio");
    // A header and nothing else — never the household's spending.
    expect(childCsv).not.toContain("Physio");
    expect(parseCsv(childCsv)).toHaveLength(1);
  });

  it("exports an empty month as a header alone rather than failing", async () => {
    const { householdId, actor } = await household();
    expect(parseCsv(await exportExpensesCsv(actor, householdId, "2019-01"))).toHaveLength(1);
  });
});

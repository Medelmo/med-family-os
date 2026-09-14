import { describe, expect, it } from "vitest";
import { duplicateKey, planExpenseImport, IMPORT_MAX_ROWS } from "../../../domain/finance/expenseImport";

function plan(text: string, options?: Parameters<typeof planExpenseImport>[1]) {
  const result = planExpenseImport(text, options);
  if (!result.ok) throw new Error(`expected a plan, got ${result.error}`);
  return result;
}

const HEADER = "Date,Description,Amount,Currency,Category,Merchant";

describe("the file as a whole", () => {
  it("refuses an empty file", () => {
    expect(planExpenseImport("")).toMatchObject({ ok: false, error: "EMPTY_FILE" });
  });

  it("refuses a file with a header and nothing else", () => {
    expect(planExpenseImport(HEADER)).toMatchObject({ ok: false, error: "NO_HEADER" });
  });

  it("names the columns it needs when they are missing", () => {
    const result = planExpenseImport("Foo,Bar\n1,2");
    expect(result).toMatchObject({ ok: false, error: "MISSING_COLUMNS" });
    if (!result.ok) expect(result.missingColumns).toEqual(["incurredOn", "description", "amount"]);
  });

  it("refuses a file too large to review", () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `2026-05-12,Row ${i},1.00`).join("\n");
    expect(planExpenseImport(`Date,Description,Amount\n${rows}`)).toMatchObject({ ok: false, error: "TOO_MANY_ROWS" });
  });

  it("accepts German column names and a semicolon delimiter", () => {
    const result = plan("Datum;Beschreibung;Betrag\n12.05.2026;Zahnarzt;89,90");
    expect(result.rows[0]).toMatchObject({
      incurredOn: "2026-05-12",
      description: "Zahnarzt",
      amountMinor: 8990,
      currency: "EUR",
    });
  });

  it("accepts the columns in any order and ignores ones it does not know", () => {
    const result = plan("Note,Amount,Date,Description\nignored,10.00,2026-05-12,Bread");
    expect(result.rows[0]).toMatchObject({ amountMinor: 1000, incurredOn: "2026-05-12", description: "Bread" });
  });
});

describe("dates", () => {
  it("accepts ISO and German forms", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,,\n12.05.2026,B,1.00,EUR,,\n1.5.26,C,1.00,EUR,,`);
    expect(result.rows.map((r) => r.incurredOn)).toEqual(["2026-05-12", "2026-05-12", "2026-05-01"]);
  });

  // Nothing in the file settles 12/05 vs 05/12, and guessing would put an
  // expense in the wrong month silently.
  it("refuses an ambiguous slash date rather than guessing", () => {
    const result = plan(`${HEADER}\n12/05/2026,A,1.00,EUR,,`);
    expect(result.rows[0].problems.map((p) => p.code)).toContain("BAD_DATE");
  });

  it("refuses a date that does not exist", () => {
    const result = plan(`${HEADER}\n2026-02-30,A,1.00,EUR,,\n31.04.2026,B,1.00,EUR,,`);
    expect(result.rows.every((r) => r.problems.some((p) => p.code === "BAD_DATE"))).toBe(true);
  });

  it("accepts a leap day in a leap year", () => {
    const result = plan(`${HEADER}\n2028-02-29,A,1.00,EUR,,`);
    expect(result.rows[0].problems).toEqual([]);
  });
});

describe("amounts", () => {
  it("parses a German amount against the row's own currency", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,"1.234,56",EUR,,`);
    expect(result.rows[0].amountMinor).toBe(123456);
  });

  it("reports an unreadable amount instead of dropping the row", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,twenty,EUR,,`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].problems.map((p) => p.code)).toContain("BAD_AMOUNT");
    expect(result.rejected).toBe(1);
    expect(result.importable).toBe(0);
  });

  // A bank export mixes income and spending; a credit is not an expense,
  // and storing it as a negative one would quietly reduce a category total.
  it("reports a credit rather than storing a negative expense", () => {
    const result = plan(`${HEADER}\n2026-05-12,Refund,-20.00,EUR,,`);
    expect(result.rows[0].problems.map((p) => p.code)).toContain("NON_POSITIVE_AMOUNT");
  });

  it("uses the household default when the file names no currency", () => {
    const result = plan("Date,Description,Amount\n2026-05-12,A,10.00", { defaultCurrency: "CHF" });
    expect(result.rows[0].currency).toBe("CHF");
  });

  it("reports a currency it cannot recognise", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,10.00,Euro,,`);
    expect(result.rows[0].problems.map((p) => p.code)).toContain("BAD_CURRENCY");
  });
});

describe("categories and descriptions", () => {
  it("defaults an absent category to OTHER without complaint", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,,`);
    expect(result.rows[0].category).toBe("OTHER");
    expect(result.rows[0].problems).toEqual([]);
  });

  it("accepts a known category case-insensitively", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,health,`);
    expect(result.rows[0].category).toBe("HEALTH");
  });

  it("reports a category it does not know rather than silently filing it as OTHER", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,Wellness,`);
    expect(result.rows[0].problems.map((p) => p.code)).toContain("UNKNOWN_CATEGORY");
  });

  it("requires a description", () => {
    const result = plan(`${HEADER}\n2026-05-12,,1.00,EUR,,`);
    expect(result.rows[0].problems.map((p) => p.code)).toContain("MISSING_DESCRIPTION");
  });
});

describe("review information", () => {
  it("numbers rows the way a spreadsheet does, counting the header", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,,\n2026-05-13,B,2.00,EUR,,`);
    expect(result.rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it("counts what will and will not be imported", () => {
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,,\n2026-05-13,,2.00,EUR,,\n2026-05-14,C,nope,EUR,,`);
    expect(result.importable).toBe(1);
    expect(result.rejected).toBe(2);
  });

  it("flags a row that already exists, without refusing it", () => {
    const existing = new Set([duplicateKey({ incurredOn: "2026-05-12", description: "A", amountMinor: 100, currency: "EUR" })]);
    const result = plan(`${HEADER}\n2026-05-12,A,1.00,EUR,,\n2026-05-13,B,1.00,EUR,,`, { existing });
    expect(result.rows.map((r) => r.possibleDuplicate)).toEqual([true, false]);
    // Still importable: re-importing on purpose is legitimate.
    expect(result.importable).toBe(2);
  });

  it("does not call a rejected row a duplicate", () => {
    const existing = { has: () => true };
    const result = plan(`${HEADER}\n2026-05-12,,1.00,EUR,,`, { existing });
    expect(result.rows[0].possibleDuplicate).toBe(false);
  });
});

describe("the same text always plans the same way", () => {
  // The preview and the write run this function on the same input, which
  // is what makes it impossible for them to disagree (ADR-015 §2).
  it("is deterministic", () => {
    const text = `${HEADER}\n2026-05-12,A,"1.234,56",EUR,HEALTH,Praxis`;
    expect(planExpenseImport(text)).toEqual(planExpenseImport(text));
  });
});

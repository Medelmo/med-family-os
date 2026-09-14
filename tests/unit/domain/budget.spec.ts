import { describe, expect, it } from "vitest";
import { coversMonth, monthOf, projectBudgets, type Budget, type CategorySpend } from "../../../domain/finance/budget";

const NOW = new Date("2026-03-10T09:00:00Z");

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "b1",
    householdId: "h1",
    category: "GROCERIES",
    currency: "EUR",
    monthlyLimitMinor: 60_000,
    startsOn: "2026-01-01",
    endsOn: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const spend = (overrides: Partial<CategorySpend> = {}): CategorySpend => ({
  category: "GROCERIES",
  currency: "EUR",
  spentMinor: 0,
  ...overrides,
});

describe("coversMonth", () => {
  it("includes the starting month itself", () => {
    expect(coversMonth({ startsOn: "2026-03-15", endsOn: null }, "2026-03")).toBe(true);
  });

  it("excludes months before it starts", () => {
    expect(coversMonth({ startsOn: "2026-03-01", endsOn: null }, "2026-02")).toBe(false);
  });

  it("includes the ending month itself and excludes what follows", () => {
    expect(coversMonth({ startsOn: "2026-01-01", endsOn: "2026-03-04" }, "2026-03")).toBe(true);
    expect(coversMonth({ startsOn: "2026-01-01", endsOn: "2026-03-04" }, "2026-04")).toBe(false);
  });

  it("runs indefinitely with no end date", () => {
    expect(coversMonth({ startsOn: "2026-01-01", endsOn: null }, "2099-12")).toBe(true);
  });
});

describe("projectBudgets", () => {
  it("reports an envelope with no spend as fully remaining", () => {
    const [status] = projectBudgets([budget()], [], "2026-03");
    expect(status).toMatchObject({
      limitMinor: 60_000,
      spentMinor: 0,
      remainingMinor: 60_000,
      usedFraction: 0,
      health: "UNDER",
    });
  });

  it("adds up spend within the category and currency", () => {
    const statuses = projectBudgets(
      [budget()],
      [spend({ spentMinor: 12_000 }), spend({ spentMinor: 8_000 })],
      "2026-03"
    );
    expect(statuses[0]).toMatchObject({ spentMinor: 20_000, remainingMinor: 40_000 });
  });

  it("ignores spend in another category or another currency", () => {
    const statuses = projectBudgets(
      [budget()],
      [spend({ category: "LEISURE", spentMinor: 50_000 }), spend({ currency: "CHF", spentMinor: 50_000 })],
      "2026-03"
    );
    expect(statuses[0].spentMinor).toBe(0);
  });

  it("goes NEAR at 85% and OVER only above the limit", () => {
    const at = (spentMinor: number) => projectBudgets([budget()], [spend({ spentMinor })], "2026-03")[0].health;
    expect(at(50_000)).toBe("UNDER");
    expect(at(51_000)).toBe("NEAR"); // exactly 85%
    expect(at(60_000)).toBe("NEAR"); // exactly at the limit is not yet over
    expect(at(60_001)).toBe("OVER");
  });

  it("reports a negative remainder once the envelope is exceeded", () => {
    const [status] = projectBudgets([budget()], [spend({ spentMinor: 75_000 })], "2026-03");
    expect(status.remainingMinor).toBe(-15_000);
    expect(status.usedFraction).toBeCloseTo(1.25);
  });

  it("leaves out envelopes that do not cover the month", () => {
    const statuses = projectBudgets([budget({ endsOn: "2026-02-28" })], [], "2026-03");
    expect(statuses).toEqual([]);
  });

  it("orders the most-used envelope first, then by category for a stable render", () => {
    const statuses = projectBudgets(
      [
        budget({ id: "b1", category: "GROCERIES" }),
        budget({ id: "b2", category: "LEISURE" }),
        budget({ id: "b3", category: "TRANSPORT" }),
      ],
      [spend({ category: "LEISURE", spentMinor: 59_000 })],
      "2026-03"
    );
    expect(statuses.map((s) => s.category)).toEqual(["LEISURE", "GROCERIES", "TRANSPORT"]);
  });
});

describe("monthOf", () => {
  it("takes the year and month from an ISO date", () => {
    expect(monthOf("2026-03-31")).toBe("2026-03");
  });
});

import { describe, expect, it } from "vitest";
import {
  coverEndsOn,
  defaultSensitivityFor,
  isCoverActive,
  nextMaintenanceDue,
  validateMaintenance,
  validateWarranty,
  ASSET_CATEGORIES,
} from "../../../domain/assets/asset";

const TODAY = "2026-06-01";

describe("sensitivity by category", () => {
  // A wheelchair or a nebuliser in the asset list says something about a
  // household member's health; a dishwasher says nothing about anybody.
  it("raises medical and mobility assets, and only those", () => {
    expect(defaultSensitivityFor("MEDICAL")).toBe("SENSITIVE");
    expect(defaultSensitivityFor("MOBILITY")).toBe("SENSITIVE");

    const others = ASSET_CATEGORIES.filter((c) => c !== "MEDICAL" && c !== "MOBILITY");
    expect(others.map(defaultSensitivityFor)).toEqual(others.map(() => "NORMAL"));
  });
});

describe("warranties", () => {
  it("requires somebody to be on the hook", () => {
    expect(validateWarranty({ provider: "  ", startsOn: "2026-01-01", endsOn: "2027-01-01" })).toMatchObject({
      ok: false,
      rejection: { code: "PROVIDER_REQUIRED" },
    });
  });

  it("refuses cover that ends before it starts", () => {
    expect(validateWarranty({ provider: "MediaMarkt", startsOn: "2027-01-01", endsOn: "2026-01-01" })).toMatchObject({
      ok: false,
      rejection: { code: "WARRANTY_DATES_OUT_OF_ORDER" },
    });
  });

  it("accepts a single-day cover", () => {
    expect(validateWarranty({ provider: "MediaMarkt", startsOn: "2026-01-01", endsOn: "2026-01-01" })).toMatchObject({
      ok: true,
    });
  });
});

describe("when cover ends", () => {
  it("is null when there is none", () => {
    expect(coverEndsOn([])).toBeNull();
    expect(isCoverActive([], TODAY)).toBe(false);
  });

  // Two overlapping covers — a retailer's year and a manufacturer's three
  // — leave the household protected until the later one runs out.
  it("takes the latest end date across overlapping warranties", () => {
    expect(coverEndsOn([{ endsOn: "2027-01-01" }, { endsOn: "2029-01-01" }, { endsOn: "2026-06-01" }])).toBe(
      "2029-01-01"
    );
  });

  it("counts cover ending today as still active", () => {
    expect(isCoverActive([{ endsOn: TODAY }], TODAY)).toBe(true);
    expect(isCoverActive([{ endsOn: "2026-05-31" }], TODAY)).toBe(false);
  });
});

describe("when the next service is due", () => {
  const record = (performedOn: string, nextDueOn: string | null, createdAt = new Date("2026-01-01T00:00:00Z")) => ({
    performedOn,
    nextDueOn,
    createdAt,
  });

  it("is null with no history", () => {
    expect(nextMaintenanceDue([])).toBeNull();
  });

  // Each service supersedes the plan the one before it set: a machine
  // serviced early in March is not still due the date February predicted.
  it("takes the most recent service, not the earliest outstanding date", () => {
    expect(
      nextMaintenanceDue([
        record("2026-02-01", "2027-02-01"),
        record("2026-03-15", "2027-03-15"),
        record("2025-11-01", "2026-11-01"),
      ])
    ).toBe("2027-03-15");
  });

  it("is null when the latest service set no next date", () => {
    expect(nextMaintenanceDue([record("2026-02-01", "2027-02-01"), record("2026-03-15", null)])).toBeNull();
  });

  // Two services on one day means somebody corrected the first.
  it("breaks a same-day tie with the record entered last", () => {
    expect(
      nextMaintenanceDue([
        record("2026-03-15", "2027-03-15", new Date("2026-03-15T09:00:00Z")),
        record("2026-03-15", "2026-09-15", new Date("2026-03-15T17:00:00Z")),
      ])
    ).toBe("2026-09-15");
  });
});

describe("recording a service", () => {
  // Dating one in the future would make "when was it last serviced?"
  // answerable with a date nobody has reached, and would quietly satisfy a
  // service that is actually overdue.
  it("refuses a service that has not happened yet", () => {
    expect(validateMaintenance({ performedOn: "2026-06-02" }, TODAY)).toMatchObject({
      ok: false,
      rejection: { code: "MAINTENANCE_IN_FUTURE" },
    });
  });

  it("accepts one performed today", () => {
    expect(validateMaintenance({ performedOn: TODAY }, TODAY)).toMatchObject({ ok: true });
  });

  it("refuses a next-due date before the service itself", () => {
    expect(validateMaintenance({ performedOn: "2026-05-01", nextDueOn: "2026-04-01" }, TODAY)).toMatchObject({
      ok: false,
      rejection: { code: "NEXT_DUE_BEFORE_PERFORMED" },
    });
  });

  it("accepts a service with no next date at all", () => {
    expect(validateMaintenance({ performedOn: "2026-05-01", nextDueOn: null }, TODAY)).toMatchObject({ ok: true });
  });
});

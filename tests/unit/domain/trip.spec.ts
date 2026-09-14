import { describe, expect, it } from "vitest";
import {
  applyTripCommand,
  daysUntilStart,
  isTripOpen,
  tripPhase,
  type Trip,
  type TripCommand,
  type TripStatus,
} from "../../../domain/travel/trip";
import {
  applyVerification,
  tripReadiness,
  validateNewTripItem,
  type TripItem,
} from "../../../domain/travel/tripItem";

const NOW = new Date("2026-06-01T09:00:00Z");
const TODAY = "2026-06-01";

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    householdId: "h1",
    title: "Half-term in Vienna",
    destination: "Vienna",
    startsOn: "2026-07-10",
    endsOn: "2026-07-17",
    status: "PLANNED",
    notes: null,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    archivedAt: null,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const apply = (status: TripStatus, command: TripCommand, overrides: Partial<Trip> = {}) =>
  applyTripCommand(trip({ status, ...overrides }), command, NOW, TODAY);

describe("the trip lifecycle", () => {
  it("plans, confirms and eventually archives", () => {
    const confirmed = apply("PLANNED", { type: "CONFIRM" });
    expect(confirmed).toMatchObject({ ok: true });
    if (confirmed.ok) expect(confirmed.transition.patch.confirmedAt).toEqual(NOW);

    // Archiving is allowed once the trip is over.
    const archived = apply("CONFIRMED", { type: "ARCHIVE" }, { startsOn: "2026-05-01", endsOn: "2026-05-08" });
    expect(archived).toMatchObject({ ok: true });
  });

  // Bookings fall through. A household that cannot record that is left
  // either lying or cancelling a trip it is still taking.
  it("lets a confirmed trip go back to planning", () => {
    const result = apply("CONFIRMED", { type: "UNCONFIRM" }, { confirmedAt: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.status).toBe("PLANNED");
      expect(result.transition.patch.confirmedAt).toBeNull();
    }
  });

  // Archiving a trip that has not happened takes it off every view that
  // exists to prepare for it.
  it("refuses to archive a trip that has not happened yet", () => {
    expect(apply("CONFIRMED", { type: "ARCHIVE" })).toMatchObject({
      ok: false,
      rejection: { code: "TRIP_NOT_OVER" },
    });
  });

  it("archives a cancelled trip whatever its dates", () => {
    expect(apply("CANCELLED", { type: "ARCHIVE" })).toMatchObject({ ok: true });
  });

  it("makes ARCHIVED terminal", () => {
    for (const command of [
      { type: "CONFIRM" },
      { type: "UNCONFIRM" },
      { type: "CANCEL" },
      { type: "ARCHIVE" },
    ] as TripCommand[]) {
      expect(apply("ARCHIVED", command), command.type).toMatchObject({ ok: false });
    }
  });

  it("does not un-cancel a trip", () => {
    expect(apply("CANCELLED", { type: "CONFIRM" })).toMatchObject({
      ok: false,
      rejection: { code: "ILLEGAL_TRANSITION" },
    });
  });

  it("records why a trip was cancelled when a reason is given", () => {
    const result = apply("CONFIRMED", { type: "CANCEL", reason: "Lukas is in hospital" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transition.patch.cancelReason).toBe("Lukas is in hospital");
  });
});

describe("the phase is derived, never stored", () => {
  const dates = { startsOn: "2026-07-10", endsOn: "2026-07-17" };

  it("reads upcoming, current and past from the dates alone", () => {
    expect(tripPhase(dates, "2026-07-09")).toBe("UPCOMING");
    expect(tripPhase(dates, "2026-07-10")).toBe("CURRENT");
    expect(tripPhase(dates, "2026-07-17")).toBe("CURRENT");
    expect(tripPhase(dates, "2026-07-18")).toBe("PAST");
  });

  it("counts whole days to the start, negative once it has begun", () => {
    expect(daysUntilStart("2026-07-10", "2026-07-01")).toBe(9);
    expect(daysUntilStart("2026-07-10", "2026-07-10")).toBe(0);
    expect(daysUntilStart("2026-07-10", "2026-07-12")).toBe(-2);
  });

  it("treats planned and confirmed trips as open", () => {
    expect(isTripOpen("PLANNED")).toBe(true);
    expect(isTripOpen("CONFIRMED")).toBe(true);
    expect(isTripOpen("CANCELLED")).toBe(false);
    expect(isTripOpen("ARCHIVED")).toBe(false);
  });
});

describe("adding an item to a trip", () => {
  const dates = { startsOn: "2026-07-10", endsOn: "2026-07-17" };

  it("requires a name", () => {
    expect(validateNewTripItem({ kind: "PACKING", title: "   " }, dates)).toMatchObject({
      ok: false,
      rejection: { code: "TITLE_REQUIRED" },
    });
  });

  // An itinerary entry that lands a day outside the trip is the kind of
  // error a household discovers at an airport.
  it("refuses an itinerary day outside the trip", () => {
    expect(validateNewTripItem({ kind: "ITINERARY", title: "Museum", onDate: "2026-07-18" }, dates)).toMatchObject({
      ok: false,
      rejection: { code: "DATE_OUTSIDE_TRIP" },
    });
    expect(validateNewTripItem({ kind: "ITINERARY", title: "Museum", onDate: "2026-07-10" }, dates)).toMatchObject({
      ok: true,
    });
  });

  it("ignores a date on a packing line rather than storing a meaningless one", () => {
    const result = validateNewTripItem({ kind: "PACKING", title: "Wheelchair charger", onDate: "2026-07-18" }, dates);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.onDate).toBeNull();
  });
});

describe("verifying an access requirement", () => {
  it("records who said so and when", () => {
    const result = applyVerification(
      { kind: "ACCESSIBILITY" },
      { status: "CONFIRMED", source: "Phoned the hotel, spoke to Frau Müller", verifiedOn: "2026-06-01" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        verification: "CONFIRMED",
        verificationSource: "Phoned the hotel, spoke to Frau Müller",
        verifiedOn: "2026-06-01",
      });
    }
  });

  // "The hotel is step-free" is worth nothing without who said so: the
  // household has to be able to weigh it, re-check it, or hold someone to
  // it on arrival.
  it("refuses an answer with no source", () => {
    expect(
      applyVerification({ kind: "ACCESSIBILITY" }, { status: "CONFIRMED", source: " ", verifiedOn: "2026-06-01" })
    ).toMatchObject({ ok: false, rejection: { code: "SOURCE_REQUIRED" } });
  });

  it("records a refusal as an answer too", () => {
    const result = applyVerification(
      { kind: "ACCESSIBILITY" },
      { status: "REFUSED", source: "They said the lift is out until autumn", verifiedOn: "2026-06-01" }
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("will not verify a packing line", () => {
    expect(
      applyVerification({ kind: "PACKING" }, { status: "CONFIRMED", source: "x", verifiedOn: "2026-06-01" })
    ).toMatchObject({ ok: false, rejection: { code: "NOT_AN_ACCESSIBILITY_ITEM" } });
  });
});

describe("readiness", () => {
  const item = (overrides: Partial<Pick<TripItem, "kind" | "done" | "verification">>) => ({
    kind: "PACKING" as const,
    done: false,
    verification: "UNVERIFIED" as const,
    ...overrides,
  });

  it("counts unticked packing and itinerary entries as outstanding", () => {
    const readiness = tripReadiness([
      item({ kind: "PACKING", done: false }),
      item({ kind: "PACKING", done: true }),
      item({ kind: "ITINERARY", done: false }),
    ]);
    expect(readiness).toMatchObject({ outstanding: 2, unverified: 0, total: 3 });
  });

  // A refusal is an answer. Treating it as an open question would nag the
  // household about something it has already settled.
  it("separates unanswered access questions from answered ones", () => {
    const readiness = tripReadiness([
      item({ kind: "ACCESSIBILITY", verification: "UNVERIFIED" }),
      item({ kind: "ACCESSIBILITY", verification: "CONFIRMED" }),
      item({ kind: "ACCESSIBILITY", verification: "REFUSED" }),
    ]);
    expect(readiness).toMatchObject({ outstanding: 0, unverified: 1, refused: 1, total: 3 });
  });

  it("never counts an access requirement as outstanding work", () => {
    const readiness = tripReadiness([item({ kind: "ACCESSIBILITY", done: false, verification: "CONFIRMED" })]);
    expect(readiness.outstanding).toBe(0);
  });

  it("is all zeroes for a trip with nothing on it", () => {
    expect(tripReadiness([])).toEqual({ outstanding: 0, unverified: 0, refused: 0, total: 0 });
  });
});

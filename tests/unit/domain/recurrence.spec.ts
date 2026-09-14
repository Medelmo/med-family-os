import { describe, expect, it } from "vitest";
import {
  expandOccurrences,
  MAX_OCCURRENCES,
  type RecurrenceRule,
  type RecurringEventDefinition,
} from "../../../domain/calendar/recurrence";
import { instantToWallClock } from "../../../domain/calendar/timezone";

const BERLIN = "Europe/Berlin";

function definition(overrides: Partial<RecurringEventDefinition> = {}): RecurringEventDefinition {
  return {
    // Tuesday 3 March 2026, 17:00 Berlin.
    start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
    durationMinutes: 60,
    timeZone: BERLIN,
    recurrence: null,
    ...overrides,
  };
}

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { frequency: "WEEKLY", interval: 1, ...overrides };
}

const WINDOW_START = new Date("2026-01-01T00:00:00Z");
const WINDOW_END = new Date("2026-12-31T23:59:59Z");

function localTimes(occurrences: { startsAt: Date }[]) {
  return occurrences.map((o) => {
    const w = instantToWallClock(o.startsAt, BERLIN);
    return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")} ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  });
}

describe("non-recurring events", () => {
  it("yields the single occurrence when it falls inside the window", () => {
    const result = expandOccurrences(definition(), WINDOW_START, WINDOW_END);
    expect(localTimes(result)).toEqual(["2026-03-03 17:00"]);
  });

  it("yields nothing when it falls outside the window", () => {
    const result = expandOccurrences(definition(), new Date("2026-06-01T00:00:00Z"), WINDOW_END);
    expect(result).toEqual([]);
  });

  it("computes the end from the duration", () => {
    const [occurrence] = expandOccurrences(definition({ durationMinutes: 90 }), WINDOW_START, WINDOW_END);
    expect(occurrence.endsAt.getTime() - occurrence.startsAt.getTime()).toBe(90 * 60 * 1000);
  });
});

describe("daily recurrence", () => {
  it("repeats every day", () => {
    const result = expandOccurrences(
      definition({ recurrence: rule({ frequency: "DAILY", count: 3 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-03-03 17:00", "2026-03-04 17:00", "2026-03-05 17:00"]);
  });

  it("honours an interval", () => {
    const result = expandOccurrences(
      definition({ recurrence: rule({ frequency: "DAILY", interval: 3, count: 3 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-03-03 17:00", "2026-03-06 17:00", "2026-03-09 17:00"]);
  });
});

describe("weekly recurrence", () => {
  it("repeats on the start's own weekday when no weekdays are given", () => {
    const result = expandOccurrences(definition({ recurrence: rule({ count: 3 }) }), WINDOW_START, WINDOW_END);
    expect(localTimes(result)).toEqual(["2026-03-03 17:00", "2026-03-10 17:00", "2026-03-17 17:00"]);
  });

  it("repeats on several named weekdays", () => {
    // Tuesdays and Thursdays.
    const result = expandOccurrences(
      definition({ recurrence: rule({ byWeekday: [2, 4], count: 4 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual([
      "2026-03-03 17:00",
      "2026-03-05 17:00",
      "2026-03-10 17:00",
      "2026-03-12 17:00",
    ]);
  });

  it("never emits before the series begins, even for an earlier weekday in the first week", () => {
    // Monday is day 1, before the Tuesday start — the Monday of the
    // starting week must not appear.
    const result = expandOccurrences(
      definition({ recurrence: rule({ byWeekday: [1, 2], count: 3 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)[0]).toBe("2026-03-03 17:00");
  });

  it("honours a fortnightly interval", () => {
    const result = expandOccurrences(
      definition({ recurrence: rule({ interval: 2, byWeekday: [2], count: 3 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-03-03 17:00", "2026-03-17 17:00", "2026-03-31 17:00"]);
  });
});

describe("monthly and yearly recurrence", () => {
  it("repeats on the same day each month", () => {
    const result = expandOccurrences(
      definition({ start: { year: 2026, month: 1, day: 15, hour: 9, minute: 0 }, recurrence: rule({ frequency: "MONTHLY", count: 3 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-01-15 09:00", "2026-02-15 09:00", "2026-03-15 09:00"]);
  });

  it("skips months that have no such day rather than inventing one", () => {
    // The 31st does not exist in February, April, June... Moving it to
    // the 28th would invent a commitment on a day nobody chose.
    const result = expandOccurrences(
      definition({ start: { year: 2026, month: 1, day: 31, hour: 9, minute: 0 }, recurrence: rule({ frequency: "MONTHLY", count: 4 }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-01-31 09:00", "2026-03-31 09:00", "2026-05-31 09:00", "2026-07-31 09:00"]);
  });

  it("repeats annually", () => {
    const result = expandOccurrences(
      definition({ start: { year: 2026, month: 6, day: 12, hour: 0, minute: 0 }, recurrence: rule({ frequency: "YEARLY", count: 3 }) }),
      WINDOW_START,
      new Date("2029-12-31T00:00:00Z")
    );
    expect(localTimes(result)).toEqual(["2026-06-12 00:00", "2027-06-12 00:00", "2028-06-12 00:00"]);
  });
});

describe("limits", () => {
  it("stops after `count` occurrences", () => {
    const result = expandOccurrences(definition({ recurrence: rule({ count: 2 }) }), WINDOW_START, WINDOW_END);
    expect(result).toHaveLength(2);
  });

  it("stops after `until`", () => {
    const result = expandOccurrences(
      definition({ recurrence: rule({ until: "2026-03-17" }) }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-03-03 17:00", "2026-03-10 17:00", "2026-03-17 17:00"]);
  });

  it("counts occurrences outside the window against `count`", () => {
    // "The first three swimming lessons" must mean the same three
    // whichever month you happen to be looking at.
    const result = expandOccurrences(
      definition({ recurrence: rule({ count: 3 }) }),
      new Date("2026-03-09T00:00:00Z"),
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-03-10 17:00", "2026-03-17 17:00"]);
  });

  it("bounds an open-ended rule so a wide window cannot exhaust the server", () => {
    const result = expandOccurrences(
      definition({ recurrence: rule({ frequency: "DAILY" }) }),
      new Date("2020-01-01T00:00:00Z"),
      new Date("2040-01-01T00:00:00Z")
    );
    expect(result.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
  });

  it("respects a caller-supplied cap", () => {
    const result = expandOccurrences(
      definition({ recurrence: rule({ frequency: "DAILY" }) }),
      WINDOW_START,
      WINDOW_END,
      10
    );
    expect(result).toHaveLength(10);
  });
});

describe("DST — the reason occurrences are generated in wall-clock terms", () => {
  it("keeps a weekly 17:00 event at 17:00 across the spring transition", () => {
    const result = expandOccurrences(
      definition({
        start: { year: 2026, month: 3, day: 22, hour: 17, minute: 0 },
        recurrence: rule({ count: 3 }),
      }),
      WINDOW_START,
      WINDOW_END
    );

    // 22 March is CET, 29 March and 5 April are CEST — all still 17:00.
    expect(localTimes(result)).toEqual(["2026-03-22 17:00", "2026-03-29 17:00", "2026-04-05 17:00"]);

    // The underlying instants are *not* evenly spaced: the first gap is an
    // hour short. Storing an instant and adding 7 days would have produced
    // 18:00 local for every occurrence after the transition.
    const gapHours = (result[1].startsAt.getTime() - result[0].startsAt.getTime()) / 3_600_000;
    expect(gapHours).toBe(7 * 24 - 1);
  });

  it("keeps a weekly 17:00 event at 17:00 across the autumn transition", () => {
    const result = expandOccurrences(
      definition({
        start: { year: 2026, month: 10, day: 18, hour: 17, minute: 0 },
        recurrence: rule({ count: 2 }),
      }),
      WINDOW_START,
      WINDOW_END
    );

    expect(localTimes(result)).toEqual(["2026-10-18 17:00", "2026-10-25 17:00"]);
    const gapHours = (result[1].startsAt.getTime() - result[0].startsAt.getTime()) / 3_600_000;
    expect(gapHours).toBe(7 * 24 + 1);
  });

  it("keeps a daily event stable right through a transition", () => {
    const result = expandOccurrences(
      definition({
        start: { year: 2026, month: 3, day: 28, hour: 8, minute: 30 },
        recurrence: rule({ frequency: "DAILY", count: 3 }),
      }),
      WINDOW_START,
      WINDOW_END
    );
    expect(localTimes(result)).toEqual(["2026-03-28 08:30", "2026-03-29 08:30", "2026-03-30 08:30"]);
  });

  it("is unaffected in a zone that does not observe DST", () => {
    const result = expandOccurrences(
      definition({
        timeZone: "UTC",
        start: { year: 2026, month: 3, day: 22, hour: 17, minute: 0 },
        recurrence: rule({ count: 2 }),
      }),
      WINDOW_START,
      WINDOW_END
    );
    const gapHours = (result[1].startsAt.getTime() - result[0].startsAt.getTime()) / 3_600_000;
    expect(gapHours).toBe(7 * 24);
  });
});

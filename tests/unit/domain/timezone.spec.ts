import { describe, expect, it } from "vitest";
import { instantToWallClock, isValidTimeZone, wallClockToInstant, zoneOffsetMs } from "../../../domain/calendar/timezone";

// CLAUDE.md §7: "DST transitions must have tests."
//
// Europe/Berlin is the worked example throughout: CET (UTC+1) in winter,
// CEST (UTC+2) in summer, springing forward 02:00→03:00 on the last
// Sunday in March and falling back 03:00→02:00 on the last Sunday in
// October. In 2026 those are 29 March and 25 October.
const BERLIN = "Europe/Berlin";

describe("zoneOffsetMs", () => {
  it("reports +1h in Berlin winter and +2h in Berlin summer", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), BERLIN)).toBe(60 * 60 * 1000);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), BERLIN)).toBe(2 * 60 * 60 * 1000);
  });

  it("reports zero for UTC all year", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "UTC")).toBe(0);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "UTC")).toBe(0);
  });

  it("handles a southern-hemisphere zone, where the seasons are reversed", () => {
    // Australia/Sydney: UTC+11 in January (their summer), UTC+10 in July.
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "Australia/Sydney")).toBe(11 * 60 * 60 * 1000);
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "Australia/Sydney")).toBe(10 * 60 * 60 * 1000);
  });
});

describe("wallClockToInstant", () => {
  it("converts an ordinary winter time", () => {
    const instant = wallClockToInstant({ year: 2026, month: 1, day: 15, hour: 17, minute: 0 }, BERLIN);
    expect(instant.toISOString()).toBe("2026-01-15T16:00:00.000Z");
  });

  it("converts an ordinary summer time", () => {
    const instant = wallClockToInstant({ year: 2026, month: 7, day: 15, hour: 17, minute: 0 }, BERLIN);
    expect(instant.toISOString()).toBe("2026-07-15T15:00:00.000Z");
  });

  it("round-trips any wall clock back to itself", () => {
    for (const [month, day] of [
      [1, 15],
      [3, 28],
      [3, 30],
      [7, 15],
      [10, 24],
      [10, 26],
      [12, 31],
    ]) {
      const wall = { year: 2026, month, day, hour: 17, minute: 30 };
      const back = instantToWallClock(wallClockToInstant(wall, BERLIN), BERLIN);
      expect({ year: back.year, month: back.month, day: back.day, hour: back.hour, minute: back.minute }).toEqual(wall);
    }
  });

  it("resolves a time skipped by the spring-forward rather than failing", () => {
    // 02:30 does not exist on 29 March 2026 in Berlin — the clocks jump
    // 02:00 → 03:00. A recurring event must not vanish or error here.
    const instant = wallClockToInstant({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, BERLIN);
    const wall = instantToWallClock(instant, BERLIN);
    expect(wall.hour).toBe(3);
    expect(wall.minute).toBe(30);
  });

  it("picks the first of the two readings on the autumn fall-back", () => {
    // 02:30 happens twice on 25 October 2026. The first is still CEST
    // (UTC+2), so the instant is 00:30Z.
    const instant = wallClockToInstant({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, BERLIN);
    expect(instant.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("wall-clock stability across DST — the reason this module exists", () => {
  it("keeps a weekly 17:00 appointment at 17:00 across the spring transition", () => {
    // Sundays either side of the 29 March 2026 spring-forward.
    const before = wallClockToInstant({ year: 2026, month: 3, day: 22, hour: 17, minute: 0 }, BERLIN);
    const after = wallClockToInstant({ year: 2026, month: 3, day: 29, hour: 17, minute: 0 }, BERLIN);

    // Both still read 17:00 locally...
    expect(instantToWallClock(before, BERLIN).hour).toBe(17);
    expect(instantToWallClock(after, BERLIN).hour).toBe(17);

    // ...even though they are 23 real hours apart, not 24*7. Naively
    // adding seven days to a stored UTC instant would have produced 18:00.
    const hoursApart = (after.getTime() - before.getTime()) / 3_600_000;
    expect(hoursApart).toBe(7 * 24 - 1);
  });

  it("keeps a weekly 17:00 appointment at 17:00 across the autumn transition", () => {
    const before = wallClockToInstant({ year: 2026, month: 10, day: 18, hour: 17, minute: 0 }, BERLIN);
    const after = wallClockToInstant({ year: 2026, month: 10, day: 25, hour: 17, minute: 0 }, BERLIN);

    expect(instantToWallClock(before, BERLIN).hour).toBe(17);
    expect(instantToWallClock(after, BERLIN).hour).toBe(17);
    expect((after.getTime() - before.getTime()) / 3_600_000).toBe(7 * 24 + 1);
  });
});

describe("isValidTimeZone", () => {
  it("accepts real zones and rejects nonsense", () => {
    expect(isValidTimeZone(BERLIN)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

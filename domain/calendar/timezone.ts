/**
 * Wall-clock ↔ instant conversion for a named IANA timezone.
 *
 * This exists because a recurring household event is defined in *wall
 * clock* terms — "swimming, Tuesdays at 17:00" — not as a fixed instant.
 * Storing a UTC instant and adding seven days repeatedly drifts by an hour
 * across a DST boundary, and the family turns up at the pool at the wrong
 * time. CLAUDE.md §7 requires the timezone to be explicit for exactly this
 * reason, and requires DST transitions to have tests.
 *
 * Implemented with `Intl` rather than a date library: the whole need is
 * two functions, and the IANA rules are already in the platform. See
 * docs/architecture/adr/ADR-014-recurrence.md for why no dependency was
 * added.
 */

export interface WallClock {
  year: number;
  /** 1-12, as humans write it. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PARTS_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PARTS_FORMAT_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS_FORMAT_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading a given instant produces in a zone. */
export function instantToWallClock(instant: Date, timeZone: string): WallClock & { second: number } {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** The zone's UTC offset, in milliseconds, at a given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = instantToWallClock(instant, timeZone);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Millisecond precision is lost by the formatter, so compare on whole
  // seconds to avoid a spurious sub-second offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * Two DST edge cases have no single right answer, and this picks
 * deliberately:
 *
 * - **Spring forward** — 02:30 simply does not exist on the day Berlin
 *   jumps 02:00→03:00. Rather than throw (which would mean a recurring
 *   event vanishing once a year and, worse, an error page for the person
 *   who scheduled it months ago), the time resolves forward into 03:30.
 *   The event happens, an hour later than written, which is what a person
 *   expects when the hour they named was skipped.
 * - **Autumn back** — 02:30 happens twice. This returns the *first*
 *   (still-DST) occurrence, matching how calendars and people generally
 *   read "half past two" on that morning.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);

  // Bracket the wall time with the offsets in force a day either side. A
  // zone shifts at most once in a day, so these two are the only offsets
  // that can apply — and around a transition they differ, which is what
  // produces the two candidate instants below.
  const offsetBefore = zoneOffsetMs(new Date(naive - DAY_MS), timeZone);
  const offsetAfter = zoneOffsetMs(new Date(naive + DAY_MS), timeZone);

  const candidates = offsetBefore === offsetAfter ? [naive - offsetBefore] : [naive - offsetBefore, naive - offsetAfter];

  const valid = candidates.filter((candidate) => readsAs(new Date(candidate), wall, timeZone));

  if (valid.length > 0) {
    // Ambiguous (autumn fall-back): both readings are real, and the
    // earlier one is the first time the clock shows this value.
    return new Date(Math.min(...valid));
  }

  // No candidate round-trips, so the wall time falls in a spring-forward
  // gap and does not exist. Applying the *pre*-transition offset lands
  // just past the gap — 02:30 becomes 03:30 — which is the "resolve
  // forward" behaviour documented above.
  return new Date(naive - offsetBefore);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function readsAs(instant: Date, wall: WallClock, timeZone: string): boolean {
  const actual = instantToWallClock(instant, timeZone);
  return (
    actual.year === wall.year &&
    actual.month === wall.month &&
    actual.day === wall.day &&
    actual.hour === wall.hour &&
    actual.minute === wall.minute
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

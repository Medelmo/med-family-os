import { instantToWallClock, wallClockToInstant, type WallClock } from "./timezone";

/**
 * A deliberately small recurrence model.
 *
 * Full RFC 5545 covers things a household calendar never asks for
 * ("the second-to-last workday of every third month"). This covers what
 * families actually schedule — swimming every Tuesday, rent on the 1st,
 * a birthday every year — and nothing else. See
 * docs/architecture/adr/ADR-014-recurrence.md.
 *
 * Occurrences are generated in *wall-clock* terms and only then converted
 * to instants, which is what keeps "every Tuesday at 17:00" at 17:00
 * across a DST boundary (CLAUDE.md §7).
 */

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** 0 = Sunday, matching Date.getUTCDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** Every N periods; 1 means every period. */
  interval: number;
  /** WEEKLY only: which days. Empty means "the day the series starts on". */
  byWeekday?: Weekday[];
  /** Stop after this many occurrences. */
  count?: number;
  /** Stop after this date (inclusive), as "YYYY-MM-DD" in the event's zone. */
  until?: string;
}

export const DEFAULT_RULE: RecurrenceRule = { frequency: "WEEKLY", interval: 1 };

export interface RecurringEventDefinition {
  /** The first occurrence, in the event's own timezone. */
  start: WallClock;
  durationMinutes: number;
  timeZone: string;
  recurrence: RecurrenceRule | null;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

/**
 * A hard ceiling on how many occurrences one expansion may produce.
 *
 * A daily event with no end date is legitimate, and a caller asking for a
 * decade of it would otherwise build a list of thousands. Callers pass a
 * window; this stops a wide one becoming a denial of service against the
 * household's own server.
 */
export const MAX_OCCURRENCES = 500;

function addDaysToWallClock(wall: WallClock, days: number): WallClock {
  // Arithmetic in UTC purely as a calendar, never as an instant — this
  // never touches a timezone, so DST cannot corrupt it.
  const asUtc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute));
  asUtc.setUTCDate(asUtc.getUTCDate() + days);
  return {
    year: asUtc.getUTCFullYear(),
    month: asUtc.getUTCMonth() + 1,
    day: asUtc.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

function addMonthsToWallClock(wall: WallClock, months: number): WallClock | null {
  const targetMonthIndex = wall.month - 1 + months;
  const year = wall.year + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;

  // A monthly event on the 31st simply has no occurrence in February.
  // Skipping is the honest answer: silently moving it to the 28th would
  // invent a commitment on a day nobody chose.
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (wall.day > daysInMonth) return null;

  return { year, month: month + 1, day: wall.day, hour: wall.hour, minute: wall.minute };
}

function wallClockWeekday(wall: WallClock): Weekday {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() as Weekday;
}

function isoDateOf(wall: WallClock): string {
  return `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

/**
 * Expands a definition into the occurrences overlapping [windowStart,
 * windowEnd].
 *
 * Generates candidates in wall-clock terms, converts each to an instant
 * with its own timezone offset, and filters by the window — so an event
 * that shifts across a DST boundary is still placed correctly relative to
 * the window.
 */
export function expandOccurrences(
  definition: RecurringEventDefinition,
  windowStart: Date,
  windowEnd: Date,
  maxOccurrences: number = MAX_OCCURRENCES
): Occurrence[] {
  const { start, durationMinutes, timeZone, recurrence } = definition;
  const durationMs = durationMinutes * 60 * 1000;

  const toOccurrence = (wall: WallClock): Occurrence => {
    const startsAt = wallClockToInstant(wall, timeZone);
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
  };

  if (!recurrence) {
    const single = toOccurrence(start);
    return overlapsWindow(single, windowStart, windowEnd) ? [single] : [];
  }

  const interval = Math.max(1, Math.trunc(recurrence.interval));
  const occurrences: Occurrence[] = [];
  let emitted = 0;

  for (const wall of candidateWallClocks(start, recurrence, interval, maxOccurrences)) {
    if (recurrence.until && isoDateOf(wall) > recurrence.until) break;

    const occurrence = toOccurrence(wall);

    // The window filter is separate from the count: `count` limits the
    // series itself, so an occurrence outside the window still consumes
    // one. Counting only what the window shows would make "the first 5
    // swimming lessons" mean something different depending on which month
    // you happened to be looking at.
    emitted += 1;
    if (recurrence.count !== undefined && emitted > recurrence.count) break;

    if (occurrence.startsAt.getTime() > windowEnd.getTime()) break;
    if (overlapsWindow(occurrence, windowStart, windowEnd)) occurrences.push(occurrence);
    if (occurrences.length >= maxOccurrences) break;
  }

  return occurrences;
}

function overlapsWindow(occurrence: Occurrence, windowStart: Date, windowEnd: Date): boolean {
  return occurrence.endsAt.getTime() >= windowStart.getTime() && occurrence.startsAt.getTime() <= windowEnd.getTime();
}

/** Lazily yields wall-clock candidates, so an open-ended rule is safe. */
function* candidateWallClocks(
  start: WallClock,
  recurrence: RecurrenceRule,
  interval: number,
  maxIterations: number
): Generator<WallClock> {
  const weekdays =
    recurrence.frequency === "WEEKLY" && recurrence.byWeekday?.length
      ? [...new Set(recurrence.byWeekday)].sort((a, b) => a - b)
      : null;

  // A generous iteration ceiling: candidates can be skipped (a monthly
  // 31st, a weekday before the series starts), so this must exceed the
  // number of occurrences the caller will accept.
  const hardStop = maxIterations * 8 + 64;

  if (recurrence.frequency === "WEEKLY" && weekdays) {
    const startWeekday = wallClockWeekday(start);
    // Move back to the start of the series' own week, then walk weeks.
    const weekStart = addDaysToWallClock(start, -startWeekday);

    for (let week = 0, produced = 0; produced < hardStop; week += interval) {
      for (const weekday of weekdays) {
        const candidate = addDaysToWallClock(weekStart, week * 7 + weekday);
        produced += 1;
        // Never emit before the series begins, even if an earlier weekday
        // in the first week matches.
        if (isoDateOf(candidate) < isoDateOf(start)) continue;
        yield candidate;
      }
    }
    return;
  }

  for (let step = 0, produced = 0; produced < hardStop; step += 1, produced += 1) {
    const offset = step * interval;
    let candidate: WallClock | null;

    switch (recurrence.frequency) {
      case "DAILY":
        candidate = addDaysToWallClock(start, offset);
        break;
      case "WEEKLY":
        candidate = addDaysToWallClock(start, offset * 7);
        break;
      case "MONTHLY":
        candidate = addMonthsToWallClock(start, offset);
        break;
      case "YEARLY":
        candidate = addMonthsToWallClock(start, offset * 12);
        break;
    }

    if (candidate) yield candidate;
  }
}

/** The wall clock an instant reads as in the event's zone. */
export function instantToEventWallClock(instant: Date, timeZone: string): WallClock {
  const { year, month, day, hour, minute } = instantToWallClock(instant, timeZone);
  return { year, month, day, hour, minute };
}

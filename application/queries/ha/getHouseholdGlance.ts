import { and, asc, count, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { calendarEvents, cases, deadlines, reimbursements, tasks, trips } from "../../../db/schema";
import { expandOccurrences, type RecurrenceRule } from "../../../domain/calendar/recurrence";
import { wallClockToInstant } from "../../../domain/calendar/timezone";
import { householdToday } from "../../time";
import { getHouseholdTimezone } from "../tasks/getTasks";

/**
 * The Home Assistant projection: numbers and dates, and nothing else.
 *
 * CLAUDE.md §10 permits a summary containing overdue counts, critical
 * items, waiting items, today, next deadlines, family events and an
 * upcoming trip, and forbids passwords, secrets, health details,
 * children's sensitive data, document contents and detailed financial
 * transactions.
 *
 * **This projection is narrower than §10 allows, on purpose: it carries no
 * free text at all.** Every title in this application is user-authored. A
 * household that writes "Lukas — oncology follow-up" as a task title has
 * no way to know it will be rendered on a tablet in the hallway, and
 * §10's ban on health details simply cannot be enforced against a text
 * field somebody typed. So the wall display gets counts and dates, and a
 * link into the real app for anyone who is actually signed in.
 *
 * Counts deliberately span **every** item in the household, sensitive
 * ones included. A count carries no content — "three things need
 * attention" reveals nothing about what they are — and a badge that
 * quietly under-reports because two of them were medical would defeat the
 * point of having it.
 *
 * There is no `Actor` here because there is no user. The caller is a
 * machine holding a scoped token (see infrastructure/integrations/haToken.ts),
 * and the safety property is this function's shape, not a policy check:
 * it is incapable of returning anything but integers and dates.
 */
export interface HouseholdGlance {
  /** When this was computed, so a stale dashboard is visibly stale. */
  generatedAt: string;
  /** The household's own today, in its own timezone (CLAUDE.md §7). */
  todayIso: string;
  overdue: number;
  dueToday: number;
  critical: number;
  waiting: number;
  eventsToday: number;
  /** Date only. */
  nextDeadlineOn: string | null;
  nextTripStartsOn: string | null;
}

const OPEN_TASK_STATUSES = ["PLANNED", "IN_PROGRESS", "WAITING"] as const;
const OPEN_CASE_STATUSES = ["DRAFT", "ACTIVE", "WAITING", "BLOCKED"] as const;

export async function getHouseholdGlance(householdId: string, now: Date = new Date()): Promise<HouseholdGlance> {
  const timezone = await getHouseholdTimezone(householdId);
  const todayIso = householdToday(timezone, now);

  const [overdue, dueToday, criticalTasks, criticalCases, waitingTasks, waitingCases, waitingClaims] =
    await Promise.all([
      countRows(
        and(
          eq(tasks.householdId, householdId),
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          lt(tasks.dueOn, sql`${todayIso}::date`)
        ),
        tasks
      ),
      countRows(
        and(
          eq(tasks.householdId, householdId),
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          eq(tasks.dueOn, sql`${todayIso}::date`)
        ),
        tasks
      ),
      countRows(
        and(
          eq(tasks.householdId, householdId),
          inArray(tasks.status, [...OPEN_TASK_STATUSES]),
          eq(tasks.priority, "CRITICAL")
        ),
        tasks
      ),
      countRows(
        and(
          eq(cases.householdId, householdId),
          inArray(cases.status, [...OPEN_CASE_STATUSES]),
          eq(cases.priority, "CRITICAL")
        ),
        cases
      ),
      countRows(and(eq(tasks.householdId, householdId), eq(tasks.status, "WAITING")), tasks),
      countRows(and(eq(cases.householdId, householdId), eq(cases.status, "WAITING")), cases),
      countRows(
        and(eq(reimbursements.householdId, householdId), inArray(reimbursements.status, ["SUBMITTED", "WAITING"])),
        reimbursements
      ),
    ]);

  const [nextDeadline] = await db
    .select({ dueOn: deadlines.dueOn })
    .from(deadlines)
    .where(
      and(
        eq(deadlines.householdId, householdId),
        isNull(deadlines.metAt),
        isNull(deadlines.archivedAt),
        gte(deadlines.dueOn, sql`${todayIso}::date`)
      )
    )
    .orderBy(asc(deadlines.dueOn))
    .limit(1);

  const [nextTrip] = await db
    .select({ startsOn: trips.startsOn })
    .from(trips)
    .where(
      and(
        eq(trips.householdId, householdId),
        inArray(trips.status, ["PLANNED", "CONFIRMED"]),
        gte(trips.startsOn, sql`${todayIso}::date`)
      )
    )
    .orderBy(asc(trips.startsOn))
    .limit(1);

  return {
    generatedAt: now.toISOString(),
    todayIso,
    overdue,
    dueToday,
    critical: criticalTasks + criticalCases,
    waiting: waitingTasks + waitingCases + waitingClaims,
    eventsToday: await countEventsToday(householdId, todayIso, timezone),
    // A `date` column comes back as a Date at UTC midnight; reading the UTC
    // parts is what keeps a date-only value from drifting a day.
    nextDeadlineOn: nextDeadline ? toIsoDate(nextDeadline.dueOn) : null,
    nextTripStartsOn: nextTrip ? nextTrip.startsOn : null,
  };
}

type CountableTable = typeof tasks | typeof cases | typeof reimbursements;

async function countRows(where: ReturnType<typeof and>, table: CountableTable): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

function toIsoDate(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

/**
 * How many calendar occurrences fall on the household's today.
 *
 * Uses the same pure `expandOccurrences` the calendar page uses, rather
 * than a second expansion written for this endpoint — a recurring event
 * that counted differently on the wall tablet than in the app would be
 * worse than not showing it at all.
 */
async function countEventsToday(householdId: string, todayIso: string, timezone: string): Promise<number> {
  const [year, month, day] = todayIso.split("-").map(Number);
  const dayStart = wallClockToInstant({ year, month, day, hour: 0, minute: 0 }, timezone);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        isNull(calendarEvents.archivedAt),
        lte(calendarEvents.startsAtUtc, dayEnd),
        or(isNull(calendarEvents.endsAtUtc), gte(calendarEvents.endsAtUtc, dayStart))
      )
    )
    .limit(200);

  let total = 0;
  for (const row of rows) {
    total += expandOccurrences(
      {
        start: {
          year: row.startYear,
          month: row.startMonth,
          day: row.startDay,
          hour: row.startHour,
          minute: row.startMinute,
        },
        durationMinutes: row.durationMinutes,
        timeZone: row.timeZone,
        recurrence: (row.recurrence ?? null) as RecurrenceRule | null,
      },
      dayStart,
      dayEnd
    ).length;
  }

  return total;
}

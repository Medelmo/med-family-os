import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { calendarEventPeople, calendarEvents } from "../../../db/schema";
import { canAccess, type Actor } from "../../policies/authorize";
import { expandOccurrences, type RecurrenceRule } from "../../../domain/calendar/recurrence";

export interface CalendarOccurrence {
  eventId: string;
  title: string;
  location: string | null;
  allDay: boolean;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  isRecurring: boolean;
}

/**
 * Occurrences overlapping a window, expanded from the stored rules.
 *
 * Recurrences are expanded on read rather than materialised into rows.
 * A materialised table would be a second copy of the truth that drifts
 * the moment a rule changes — the same reasoning that keeps Attention a
 * projection (docs/requirements/product-spec.md).
 *
 * The SQL pre-filter is deliberately coarse: it discards events whose
 * whole series ends before the window or begins after it, and expansion
 * decides the rest. An open-ended series (`endsAtUtc IS NULL`) always
 * survives the filter, because by definition it may have an occurrence in
 * any future window.
 */
export async function getCalendarOccurrences(
  actor: Actor,
  householdId: string,
  windowStart: Date,
  windowEnd: Date,
  limit = 200
): Promise<CalendarOccurrence[]> {
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.householdId, householdId),
        isNull(calendarEvents.archivedAt),
        lte(calendarEvents.startsAtUtc, windowEnd),
        or(isNull(calendarEvents.endsAtUtc), gte(calendarEvents.endsAtUtc, windowStart))
      )
    )
    .orderBy(asc(calendarEvents.startsAtUtc))
    .limit(limit);

  if (rows.length === 0) return [];

  const scopeRows = await db
    .select({ eventId: calendarEventPeople.eventId, personId: calendarEventPeople.personId })
    .from(calendarEventPeople)
    .where(
      inArray(
        calendarEventPeople.eventId,
        rows.map((r) => r.id)
      )
    );

  const scopeByEvent = new Map<string, string[]>();
  for (const row of scopeRows) {
    const existing = scopeByEvent.get(row.eventId);
    if (existing) existing.push(row.personId);
    else scopeByEvent.set(row.eventId, [row.personId]);
  }

  const visible = rows.filter((row) =>
    canAccess(actor, "read", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      ownerUserId: row.createdBy ?? undefined,
      personScopeIds: scopeByEvent.get(row.id)?.length ? scopeByEvent.get(row.id) : undefined,
    })
  );

  const occurrences: CalendarOccurrence[] = [];

  for (const row of visible) {
    const recurrence = (row.recurrence ?? null) as RecurrenceRule | null;
    const expanded = expandOccurrences(
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
        recurrence,
      },
      windowStart,
      windowEnd
    );

    for (const occurrence of expanded) {
      occurrences.push({
        eventId: row.id,
        title: row.title,
        location: row.location,
        allDay: row.allDay,
        timeZone: row.timeZone,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        isRecurring: recurrence !== null,
      });
    }
  }

  // One chronological list across every series — the household reads a
  // day, not an event's schedule.
  return occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { calendarEventPeople, calendarEvents } from "../../../db/schema";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { canAccess, type Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";
import { isValidTimeZone, wallClockToInstant } from "../../../domain/calendar/timezone";
import { expandOccurrences, type RecurrenceRule } from "../../../domain/calendar/recurrence";
import { getHouseholdTimezone } from "../../queries/tasks/getTasks";

const weekdaySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);

const recurrenceSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(365).default(1),
  byWeekday: z.array(weekdaySchema).max(7).optional(),
  count: z.number().int().min(1).max(500).optional(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  location: z.string().trim().max(300).nullish(),
  start: z.object({
    year: z.number().int().min(1970).max(2200),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  durationMinutes: z.number().int().min(0).max(60 * 24 * 30).default(60),
  allDay: z.boolean().default(false),
  /** Defaults to the household's zone when omitted. */
  timeZone: z.string().optional(),
  recurrence: recurrenceSchema.nullish(),
  aboutPersonIds: z.array(z.string().uuid()).default([]),
});

export type CreateCalendarEventInput = z.input<typeof createEventSchema>;

/**
 * Creates a calendar event from a wall-clock definition (ADR-014).
 *
 * The derived `startsAtUtc`/`endsAtUtc` columns are computed here, once,
 * from the same expansion the read path uses — so the ordering column can
 * never disagree with the occurrences actually shown.
 */
export async function createCalendarEvent(actor: Actor, householdId: string, input: CreateCalendarEventInput) {
  const parsed = createEventSchema.parse(input);

  const authorized = canAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    ownerUserId: actor.userId,
    personScopeIds: parsed.aboutPersonIds.length > 0 ? parsed.aboutPersonIds : undefined,
  });
  if (!authorized) throw new AuthorizationError("Not permitted to add an event to this household's calendar.");

  const timeZone = parsed.timeZone ?? (await getHouseholdTimezone(householdId));
  if (!isValidTimeZone(timeZone)) {
    throw new AuthorizationError(`Unknown timezone: ${timeZone}`);
  }

  const recurrence = (parsed.recurrence ?? null) as RecurrenceRule | null;
  const startsAtUtc = wallClockToInstant(parsed.start, timeZone);

  // Only a bounded rule has a last occurrence. An open-ended one leaves
  // endsAtUtc null rather than pretending to a horizon it does not have.
  const endsAtUtc = lastOccurrenceOf(
    { start: parsed.start, durationMinutes: parsed.durationMinutes, timeZone, recurrence },
    startsAtUtc
  );

  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(calendarEvents)
      .values({
        householdId,
        title: parsed.title,
        description: parsed.description ?? null,
        location: parsed.location ?? null,
        startYear: parsed.start.year,
        startMonth: parsed.start.month,
        startDay: parsed.start.day,
        startHour: parsed.start.hour,
        startMinute: parsed.start.minute,
        durationMinutes: parsed.durationMinutes,
        allDay: parsed.allDay,
        timeZone,
        recurrence,
        startsAtUtc,
        endsAtUtc,
        createdBy: actor.userId,
      })
      .returning();

    if (parsed.aboutPersonIds.length > 0) {
      await tx.insert(calendarEventPeople).values(parsed.aboutPersonIds.map((personId) => ({ eventId: event.id, personId })));
    }

    await recordAuditEvent(
      { householdId, actorUserId: actor.userId, action: "calendar.event_created", resourceType: "calendar_event", resourceId: event.id },
      tx
    );

    return event;
  });
}

function lastOccurrenceOf(
  definition: Parameters<typeof expandOccurrences>[0],
  startsAtUtc: Date
): Date | null {
  if (!definition.recurrence) return new Date(startsAtUtc.getTime() + definition.durationMinutes * 60_000);
  if (definition.recurrence.count === undefined && definition.recurrence.until === undefined) return null;

  const occurrences = expandOccurrences(definition, startsAtUtc, new Date("2200-01-01T00:00:00Z"));
  const last = occurrences.at(-1);
  return last ? last.endsAt : null;
}

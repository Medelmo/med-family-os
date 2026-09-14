"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { createCalendarEvent } from "../../../application/commands/calendar/createCalendarEvent";
import { AuthorizationError } from "../../../application/errors";
import type { RecurrenceFrequency, Weekday } from "../../../domain/calendar/recurrence";

export interface CalendarFormState {
  error?: string;
}

export async function submitCreateEvent(_prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const { actor, householdId } = await requireActor();

  // <input type="date"> and <input type="time"> give wall-clock strings,
  // which is exactly what the domain wants (ADR-014) — there is no
  // instant to parse and no browser timezone to get wrong here.
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "09:00");
  const frequency = String(formData.get("frequency") ?? "NONE");

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  if (!year || !month || !day) return { error: "invalid_input" };

  try {
    await createCalendarEvent(actor, householdId, {
      title: String(formData.get("title") ?? ""),
      location: String(formData.get("location") ?? "").trim() || null,
      start: { year, month, day, hour: hour ?? 0, minute: minute ?? 0 },
      durationMinutes: Number(formData.get("durationMinutes") ?? 60),
      recurrence:
        frequency === "NONE"
          ? null
          : {
              frequency: frequency as RecurrenceFrequency,
              interval: 1,
              // Weekly defaults to the weekday the series starts on, which
              // is what "every week from this date" means to a person.
              byWeekday: frequency === "WEEKLY" ? ([new Date(Date.UTC(year, month - 1, day)).getUTCDay()] as Weekday[]) : undefined,
            },
      aboutPersonIds: [],
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return { error: "not_authorized" };
    if (error instanceof ZodError) return { error: "invalid_input" };
    throw error;
  }

  revalidatePath("/calendar");
  revalidatePath("/today");
  return {};
}

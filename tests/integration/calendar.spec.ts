import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
  calendarEventPeople,
  calendarEvents,
  caseEvents,
  casePeople,
  caseTasks,
  cases,
  deadlines,
  households,
  householdMemberships,
  inboxItems,
  notifications,
  outboxEvents,
  people,
  sessionRevocations,
  taskPeople,
  tasks,
  users,
} from "../../db/schema";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { createCalendarEvent } from "../../application/commands/calendar/createCalendarEvent";
import { getCalendarOccurrences } from "../../application/queries/calendar/getCalendarEvents";
import { getToday } from "../../application/queries/attention/getAttention";
import { instantToWallClock } from "../../domain/calendar/timezone";
import type { Actor } from "../../application/policies/authorize";

/**
 * Calendar events and recurrence end to end (ADR-014). Requires
 * DATABASE_URL to point at a disposable development database.
 */

const BERLIN = "Europe/Berlin";

async function resetDatabase() {
  await db.execute(
    sql`truncate table ${calendarEventPeople}, ${calendarEvents}, ${caseEvents}, ${caseTasks}, ${casePeople}, ${cases}, ${notifications}, ${outboxEvents}, ${auditEvents}, ${deadlines}, ${taskPeople}, ${tasks}, ${inboxItems}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );
}

beforeEach(resetDatabase);
afterAll(resetDatabase);

async function household(timezone = BERLIN) {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  await db.update(households).set({ timezone }).where(eq(households.id, household.id));
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor, personId: person.id };
}

function localTimes(occurrences: { startsAt: Date; timeZone: string }[]) {
  return occurrences.map((o) => {
    const w = instantToWallClock(o.startsAt, o.timeZone);
    return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")} ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  });
}

describe("creating calendar events", () => {
  it("stores the wall clock and the zone, not just an instant", async () => {
    const { householdId, actor } = await household();
    const event = await createCalendarEvent(actor, householdId, {
      title: "Swimming",
      start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
    });

    expect(event.startYear).toBe(2026);
    expect(event.startHour).toBe(17);
    expect(event.timeZone).toBe(BERLIN);
    // The derived instant is correct for CET (UTC+1) in early March.
    expect(event.startsAtUtc.toISOString()).toBe("2026-03-03T16:00:00.000Z");
  });

  it("inherits the household's timezone when none is given", async () => {
    const { householdId, actor } = await household("Australia/Sydney");
    const event = await createCalendarEvent(actor, householdId, {
      title: "Swimming",
      start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
    });
    expect(event.timeZone).toBe("Australia/Sydney");
  });

  it("rejects an unknown timezone rather than silently falling back", async () => {
    const { householdId, actor } = await household();
    await expect(
      createCalendarEvent(actor, householdId, {
        title: "Swimming",
        start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
        timeZone: "Mars/Olympus_Mons",
      })
    ).rejects.toThrow();
  });

  it("records the last occurrence for a bounded rule and leaves it open otherwise", async () => {
    const { householdId, actor } = await household();

    const bounded = await createCalendarEvent(actor, householdId, {
      title: "Swimming term",
      start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
      recurrence: { frequency: "WEEKLY", interval: 1, count: 3 },
    });
    expect(bounded.endsAtUtc).not.toBeNull();

    const openEnded = await createCalendarEvent(actor, householdId, {
      title: "Bin day",
      start: { year: 2026, month: 3, day: 3, hour: 7, minute: 0 },
      recurrence: { frequency: "WEEKLY", interval: 1 },
    });
    // Null means "no horizon", not "unknown" — an open-ended series must
    // never be filtered out of a future window.
    expect(openEnded.endsAtUtc).toBeNull();
  });
});

describe("reading occurrences", () => {
  it("expands a recurring event across a window", async () => {
    const { householdId, actor } = await household();
    await createCalendarEvent(actor, householdId, {
      title: "Swimming",
      start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
      recurrence: { frequency: "WEEKLY", interval: 1, count: 3 },
    });

    const occurrences = await getCalendarOccurrences(
      actor,
      householdId,
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-04-01T00:00:00Z")
    );
    expect(localTimes(occurrences)).toEqual(["2026-03-03 17:00", "2026-03-10 17:00", "2026-03-17 17:00"]);
  });

  it("returns an open-ended series in a window long after it began", async () => {
    const { householdId, actor } = await household();
    await createCalendarEvent(actor, householdId, {
      title: "Bin day",
      start: { year: 2026, month: 1, day: 6, hour: 7, minute: 0 },
      recurrence: { frequency: "WEEKLY", interval: 1 },
    });

    const occurrences = await getCalendarOccurrences(
      actor,
      householdId,
      new Date("2026-11-02T00:00:00Z"),
      new Date("2026-11-09T00:00:00Z")
    );
    expect(occurrences.length).toBeGreaterThan(0);
  });

  it("merges several series into one chronological list", async () => {
    const { householdId, actor } = await household();
    await createCalendarEvent(actor, householdId, {
      title: "Evening",
      start: { year: 2026, month: 3, day: 3, hour: 18, minute: 0 },
    });
    await createCalendarEvent(actor, householdId, {
      title: "Morning",
      start: { year: 2026, month: 3, day: 3, hour: 8, minute: 0 },
    });

    const occurrences = await getCalendarOccurrences(
      actor,
      householdId,
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-03-05T00:00:00Z")
    );
    expect(occurrences.map((o) => o.title)).toEqual(["Morning", "Evening"]);
  });

  it("hides an event scoped to a person the actor is not", async () => {
    const { householdId, actor, personId } = await household();
    await createCalendarEvent(actor, householdId, {
      title: "Private appointment",
      start: { year: 2026, month: 3, day: 3, hour: 17, minute: 0 },
      aboutPersonIds: [personId],
    });

    const otherChild: Actor = {
      userId: "00000000-0000-0000-0000-0000000000ff",
      householdId,
      role: "CHILD",
      personIds: ["00000000-0000-0000-0000-0000000000ee"],
    };

    expect(
      await getCalendarOccurrences(otherChild, householdId, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-05T00:00:00Z"))
    ).toHaveLength(0);
  });
});

describe("DST through the full stack", () => {
  it("keeps a weekly 17:00 event at 17:00 either side of the spring transition", async () => {
    const { householdId, actor } = await household();
    await createCalendarEvent(actor, householdId, {
      title: "Swimming",
      start: { year: 2026, month: 3, day: 22, hour: 17, minute: 0 },
      recurrence: { frequency: "WEEKLY", interval: 1, count: 3 },
    });

    const occurrences = await getCalendarOccurrences(
      actor,
      householdId,
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-04-30T00:00:00Z")
    );

    // 22 March is CET; 29 March and 5 April are CEST. All still 17:00 —
    // which is the entire reason the wall clock is what gets stored.
    expect(localTimes(occurrences)).toEqual(["2026-03-22 17:00", "2026-03-29 17:00", "2026-04-05 17:00"]);
    expect(occurrences[0].startsAt.toISOString()).toBe("2026-03-22T16:00:00.000Z");
    expect(occurrences[1].startsAt.toISOString()).toBe("2026-03-29T15:00:00.000Z");
  });

  it("keeps a weekly 17:00 event at 17:00 either side of the autumn transition", async () => {
    const { householdId, actor } = await household();
    await createCalendarEvent(actor, householdId, {
      title: "Swimming",
      start: { year: 2026, month: 10, day: 18, hour: 17, minute: 0 },
      recurrence: { frequency: "WEEKLY", interval: 1, count: 2 },
    });

    const occurrences = await getCalendarOccurrences(
      actor,
      householdId,
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-11-30T00:00:00Z")
    );
    expect(localTimes(occurrences)).toEqual(["2026-10-18 17:00", "2026-10-25 17:00"]);
    expect(occurrences[0].startsAt.toISOString()).toBe("2026-10-18T15:00:00.000Z");
    expect(occurrences[1].startsAt.toISOString()).toBe("2026-10-25T16:00:00.000Z");
  });
});

describe("calendar events on Today", () => {
  it("shows an event scheduled for the household's today", async () => {
    const { householdId, actor } = await household();
    const now = new Date("2026-06-15T09:00:00Z"); // 11:00 in Berlin

    await createCalendarEvent(actor, householdId, {
      title: "Dentist",
      start: { year: 2026, month: 6, day: 15, hour: 14, minute: 30 },
    });

    const today = await getToday(actor, householdId, now);
    expect(today.events.map((e) => e.title)).toEqual(["Dentist"]);
  });

  it("does not spill tomorrow's early events into tonight", async () => {
    const { householdId, actor } = await household();
    // 22:00 Berlin on the 15th. A naive rolling 24h window would include
    // the following morning; the household's own day does not.
    const now = new Date("2026-06-15T20:00:00Z");

    await createCalendarEvent(actor, householdId, {
      title: "Tomorrow morning",
      start: { year: 2026, month: 6, day: 16, hour: 8, minute: 0 },
    });

    const today = await getToday(actor, householdId, now);
    expect(today.events).toHaveLength(0);
  });
});

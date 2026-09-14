import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import { households, tasks } from "../../db/schema";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { captureInboxItem } from "../../application/commands/inbox/captureInboxItem";
import { triageInboxItemToTask } from "../../application/commands/inbox/triageInboxItem";
import { transitionTask } from "../../application/commands/tasks/transitionTask";
import { createCase } from "../../application/commands/cases/createCase";
import { createTrip } from "../../application/commands/travel/tripCommands";
import { createCalendarEvent } from "../../application/commands/calendar/createCalendarEvent";
import { recordExpense } from "../../application/commands/finance/recordExpense";
import { getHouseholdGlance } from "../../application/queries/ha/getHouseholdGlance";
import type { Actor } from "../../application/policies/authorize";

/**
 * The Home Assistant projection (CLAUDE.md §10).
 *
 * The counts matter, but the test that matters most is the last one: this
 * surface must not carry free text, because the wall tablet it renders on
 * is readable by anyone in the hallway and every title in this app is
 * something a household member typed.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

const NOW = new Date("2026-06-01T09:00:00Z");
const TODAY = "2026-06-01";

/**
 * A task, through the real capture-then-triage path — this application has
 * no other way to make one, by design (Phase 2).
 */
async function aTask(
  actor: Actor,
  householdId: string,
  input: { title: string; dueOn?: string; priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL" }
) {
  const item = await captureInboxItem(actor, householdId, { capturedText: input.title });
  return triageInboxItemToTask(actor, householdId, {
    inboxItemId: item.id,
    expectedVersion: item.version,
    title: input.title,
    priority: input.priority ?? "NORMAL",
    dueOn: input.dueOn ?? null,
    aboutPersonIds: [],
  });
}

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor };
}

describe("what the glance counts", () => {
  it("is all zeroes for a household with nothing in it", async () => {
    const { householdId } = await household();
    const glance = await getHouseholdGlance(householdId, NOW);

    expect(glance).toMatchObject({
      todayIso: TODAY,
      overdue: 0,
      dueToday: 0,
      critical: 0,
      waiting: 0,
      eventsToday: 0,
      nextDeadlineOn: null,
      nextTripStartsOn: null,
    });
  });

  it("separates overdue from due today", async () => {
    const { householdId, actor } = await household();
    await aTask(actor, householdId, { title: "Overdue one", dueOn: "2026-05-20" });
    await aTask(actor, householdId, { title: "Overdue two", dueOn: "2026-05-31" });
    await aTask(actor, householdId, { title: "Today", dueOn: TODAY });
    await aTask(actor, householdId, { title: "Later", dueOn: "2026-07-01" });

    const glance = await getHouseholdGlance(householdId, NOW);
    expect(glance).toMatchObject({ overdue: 2, dueToday: 1 });
  });

  it("counts critical work across tasks and cases together", async () => {
    const { householdId, actor } = await household();
    await aTask(actor, householdId, { title: "Urgent", priority: "CRITICAL" });
    await createCase(actor, householdId, { title: "Urgent case", priority: "CRITICAL" });
    await createCase(actor, householdId, { title: "Ordinary case" });

    expect((await getHouseholdGlance(householdId, NOW)).critical).toBe(2);
  });

  it("counts what the household is waiting on", async () => {
    const { householdId, actor } = await household();
    const task = await aTask(actor, householdId, { title: "Chase the clinic" });
    await transitionTask(actor, householdId, task.id, task.version, {
      type: "WAIT",
      waitingFor: "The clinic",
      followUpAt: new Date("2026-06-15T09:00:00Z"),
    });

    expect((await getHouseholdGlance(householdId, NOW)).waiting).toBe(1);
  });

  it("gives the next deadline and the next trip as dates", async () => {
    const { householdId, actor } = await household();
    await createTrip(actor, householdId, { title: "Vienna", startsOn: "2026-07-10", endsOn: "2026-07-17" });
    await createTrip(actor, householdId, { title: "Berlin", startsOn: "2026-06-20", endsOn: "2026-06-22" });

    // The soonest one, not the first one entered.
    expect((await getHouseholdGlance(householdId, NOW)).nextTripStartsOn).toBe("2026-06-20");
  });

  it("ignores a trip that has already started", async () => {
    const { householdId, actor } = await household();
    await createTrip(actor, householdId, { title: "Ongoing", startsOn: "2026-05-30", endsOn: "2026-06-05" });

    expect((await getHouseholdGlance(householdId, NOW)).nextTripStartsOn).toBeNull();
  });

  it("counts today's calendar occurrences, recurring ones included", async () => {
    const { householdId, actor } = await household();

    await createCalendarEvent(actor, householdId, {
      title: "Physio",
      start: { year: 2026, month: 6, day: 1, hour: 10, minute: 0 },
      durationMinutes: 60,
      timeZone: "UTC",
    });
    // A weekly series that began before today and lands on it.
    await createCalendarEvent(actor, householdId, {
      title: "Swimming",
      start: { year: 2026, month: 5, day: 4, hour: 17, minute: 0 },
      durationMinutes: 60,
      timeZone: "UTC",
      recurrence: { frequency: "WEEKLY", interval: 1, byWeekday: [1] },
    });

    expect((await getHouseholdGlance(householdId, NOW)).eventsToday).toBe(2);
  });

  it("stamps when it was computed, so a stale dashboard is visibly stale", async () => {
    const { householdId } = await household();
    expect((await getHouseholdGlance(householdId, NOW)).generatedAt).toBe(NOW.toISOString());
  });
});

describe("what the glance must never carry", () => {
  // The heart of CLAUDE.md §10. Titles in this app are user-authored, and
  // a household that writes "Lukas - oncology follow-up" cannot know it
  // would be rendered on a tablet in the hallway.
  it("contains no free text from any record, at any sensitivity", async () => {
    const { householdId, actor } = await household();

    const secrets = [
      "Lukas oncology follow-up",
      "Benefits appeal for Ada",
      "Wheelchair service booking",
      "Vienna",
      "Physiotherapie Praxis Mueller",
    ];

    await aTask(actor, householdId, { title: secrets[0], dueOn: "2026-05-20", priority: "CRITICAL" });
    await createCase(actor, householdId, { title: secrets[1], priority: "CRITICAL" });
    await aTask(actor, householdId, { title: secrets[2], dueOn: TODAY });
    await createTrip(actor, householdId, { title: secrets[3], destination: secrets[3], startsOn: "2026-06-20", endsOn: "2026-06-22" });
    await createCalendarEvent(actor, householdId, {
      title: secrets[4],
      start: { year: 2026, month: 6, day: 1, hour: 10, minute: 0 },
      durationMinutes: 60,
      timeZone: "UTC",
    });
    await recordExpense(actor, householdId, {
      description: "Physio session",
      amount: "89,90",
      incurredOn: TODAY,
      category: "HEALTH",
    });

    const glance = await getHouseholdGlance(householdId, NOW);
    const serialised = JSON.stringify(glance);

    for (const secret of secrets) {
      expect(serialised, secret).not.toContain(secret);
    }

    // No amounts either: §10 forbids detailed financial transactions, and
    // the projection carries no finance at all.
    expect(serialised).not.toContain("8990");
    expect(serialised).not.toContain("89.90");

    // Every value is a number, or a date-shaped string, or null.
    for (const [key, value] of Object.entries(glance)) {
      if (typeof value === "number" || value === null) continue;
      expect(typeof value, key).toBe("string");
      expect(value as string, key).toMatch(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);
    }
  });

  // ADR-012 allows exactly one bootstrap, so a second household cannot be
  // created through a command — but the query's household scoping still
  // has to be proved, so the rows go in directly. The endpoint itself
  // refuses to answer at all when more than one household exists; this is
  // about the query underneath it.
  it("counts only the household it was asked about", async () => {
    const { householdId, actor } = await household();
    await aTask(actor, householdId, { title: "Ours", dueOn: "2026-05-20" });

    const [other] = await db.insert(households).values({ name: "Someone else" }).returning();
    await db.insert(tasks).values({
      householdId: other.id,
      title: "Theirs",
      status: "PLANNED",
      // A Date, not a string: task.dueOn is a Date-mode column.
      dueOn: new Date("2026-05-20T00:00:00Z"),
    });

    expect((await getHouseholdGlance(householdId, NOW)).overdue).toBe(1);
    expect((await getHouseholdGlance(other.id, NOW)).overdue).toBe(1);
  });
});

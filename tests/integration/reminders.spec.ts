import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
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
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { captureInboxItem } from "../../application/commands/inbox/captureInboxItem";
import { triageInboxItemToTask } from "../../application/commands/inbox/triageInboxItem";
import { transitionTask } from "../../application/commands/tasks/transitionTask";
import { createCase } from "../../application/commands/cases/createCase";
import { transitionCase } from "../../application/commands/cases/transitionCase";
import { scanForReminders } from "../../application/reminders/scanForReminders";
import { processOutbox } from "../../application/outbox/processOutbox";
import { getNotifications } from "../../application/queries/notifications/getNotifications";
import type { Actor } from "../../application/policies/authorize";

/**
 * Time-triggered reminders: the scheduled producer for the outbox
 * (ADR-004/ADR-013). Requires DATABASE_URL to point at a disposable
 * development database.
 */

async function resetDatabase() {
  await db.execute(
    sql`truncate table ${caseEvents}, ${caseTasks}, ${casePeople}, ${cases}, ${notifications}, ${outboxEvents}, ${auditEvents}, ${deadlines}, ${taskPeople}, ${tasks}, ${inboxItems}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );
}

beforeEach(resetDatabase);
afterAll(resetDatabase);

const FOLLOW_UP = new Date("2026-09-20T09:00:00Z");
const BEFORE_FOLLOW_UP = new Date("2026-09-19T09:00:00Z");
const AFTER_FOLLOW_UP = new Date("2026-09-21T09:00:00Z");

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor, personId: person.id };
}

async function waitingTask(actor: Actor, householdId: string, followUpAt: Date | null, indefinite = false) {
  const item = await captureInboxItem(actor, householdId, { capturedText: "Chase the clinic" });
  const task = await triageInboxItemToTask(actor, householdId, {
    inboxItemId: item.id,
    expectedVersion: item.version,
    title: "Chase the clinic",
    aboutPersonIds: [],
  });
  return transitionTask(actor, householdId, task.id, task.version, {
    type: "WAIT",
    waitingFor: "the clinic",
    followUpAt,
    indefinite,
  });
}

describe("task follow-up reminders", () => {
  it("emits nothing before the follow-up date", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, FOLLOW_UP);

    expect(await scanForReminders(BEFORE_FOLLOW_UP)).toMatchObject({ taskFollowUps: 0 });
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });

  it("emits once the follow-up date has passed", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, FOLLOW_UP);

    expect(await scanForReminders(AFTER_FOLLOW_UP)).toMatchObject({ taskFollowUps: 1 });

    const [event] = await db.select().from(outboxEvents);
    expect(event.eventType).toBe("task.follow_up_due");
  });

  it("does not re-announce the same follow-up on every scan", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, FOLLOW_UP);

    await scanForReminders(AFTER_FOLLOW_UP);
    await scanForReminders(AFTER_FOLLOW_UP);
    await scanForReminders(new Date("2026-09-22T09:00:00Z"));

    // The scan runs every minute in production; without this the household
    // would be told about the same overdue follow-up forever.
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
  });

  it("re-arms itself when the follow-up date is pushed later", async () => {
    const { householdId, actor, personId } = await household();
    const task = await waitingTask(actor, householdId, FOLLOW_UP);
    await scanForReminders(AFTER_FOLLOW_UP);

    // Someone chases, gets told "call back next month", and reschedules.
    const later = new Date("2026-10-20T09:00:00Z");
    // RESUME needs an owner — the state machine requires one for
    // IN_PROGRESS, which is why this passes one explicitly.
    await transitionTask(actor, householdId, task.id, task.version, { type: "RESUME", ownerPersonId: personId });
    const resumed = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0];
    await transitionTask(actor, householdId, task.id, resumed.version, {
      type: "WAIT",
      waitingFor: "the clinic",
      followUpAt: later,
    });

    await scanForReminders(new Date("2026-10-21T09:00:00Z"));

    // Two follow-up announcements: the original, and the rescheduled one.
    // No flag had to be cleared by hand for this to work. (Filtered by
    // type because resuming also assigned an owner, which legitimately
    // emits its own task.assigned event.)
    const events = await db.select().from(outboxEvents);
    expect(events.filter((e) => e.eventType === "task.follow_up_due")).toHaveLength(2);
  });

  it("ignores a task waiting indefinitely, which has no date to arrive", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, null, true);

    expect(await scanForReminders(AFTER_FOLLOW_UP)).toMatchObject({ taskFollowUps: 0 });
  });

  it("ignores a task that is no longer waiting", async () => {
    const { householdId, actor, personId } = await household();
    const task = await waitingTask(actor, householdId, FOLLOW_UP);
    await transitionTask(actor, householdId, task.id, task.version, { type: "RESUME", ownerPersonId: personId });

    expect(await scanForReminders(AFTER_FOLLOW_UP)).toMatchObject({ taskFollowUps: 0 });
  });

  it("delivers a notification naming who is being waited on", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, FOLLOW_UP);

    await scanForReminders(AFTER_FOLLOW_UP);
    await processOutbox();

    const [notification] = await getNotifications(actor);
    expect(notification.type).toBe("task.follow_up_due");
    expect(notification.title).toBe("Chase the clinic");
    expect(notification.body).toBe("the clinic");
  });
});

describe("case follow-up reminders", () => {
  async function waitingCase(actor: Actor, householdId: string, followUpAt: Date) {
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });
    return transitionCase(actor, householdId, kase.id, kase.version, {
      type: "WAIT",
      waitingFor: "the council",
      followUpAt,
    });
  }

  it("emits once the follow-up date has passed and not before", async () => {
    const { householdId, actor } = await household();
    await waitingCase(actor, householdId, FOLLOW_UP);

    expect(await scanForReminders(BEFORE_FOLLOW_UP)).toMatchObject({ caseFollowUps: 0 });
    expect(await scanForReminders(AFTER_FOLLOW_UP)).toMatchObject({ caseFollowUps: 1 });
  });

  it("does not repeat itself", async () => {
    const { householdId, actor } = await household();
    await waitingCase(actor, householdId, FOLLOW_UP);

    await scanForReminders(AFTER_FOLLOW_UP);
    await scanForReminders(AFTER_FOLLOW_UP);

    expect(await db.select().from(outboxEvents)).toHaveLength(1);
  });

  it("ignores a case parked with a stated reason instead of a date", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kindergarten place" });
    await transitionCase(actor, householdId, kase.id, kase.version, {
      type: "WAIT",
      waitingFor: "the council",
      followUpAt: null,
      noFollowUpReason: "they will write to us",
    });

    // Nothing to announce — but Attention still shows it, so it cannot
    // vanish (see tests/integration/case-flow.spec.ts).
    expect(await scanForReminders(AFTER_FOLLOW_UP)).toMatchObject({ caseFollowUps: 0 });
  });

  it("delivers the notification to the case's owner rather than its creator", async () => {
    const { householdId, actor } = await household();
    const ben = await addHouseholdMember(actor, householdId, {
      displayName: "Ben Adult",
      role: "ADULT",
      account: { email: "ben@example.test", temporaryPassword: "another long temp password" },
    });
    const benActor: Actor = {
      userId: ben.accountUserId!,
      householdId,
      role: "ADULT",
      personIds: [ben.id],
    };

    const kase = await createCase(actor, householdId, { title: "Kindergarten place", ownerPersonId: ben.id });
    await transitionCase(actor, householdId, kase.id, kase.version, {
      type: "WAIT",
      waitingFor: "the council",
      followUpAt: FOLLOW_UP,
    });

    await scanForReminders(AFTER_FOLLOW_UP);
    await processOutbox();

    expect(await getNotifications(benActor)).toHaveLength(1);
    expect(await getNotifications(actor)).toHaveLength(0);
  });
});

describe("deadline reminders", () => {
  async function deadline(householdId: string, createdBy: string, dueOn: string) {
    const [row] = await db
      .insert(deadlines)
      .values({ householdId, title: "Passport expires", dueOn: new Date(`${dueOn}T00:00:00Z`), createdBy })
      .returning();
    return row;
  }

  it("warns ahead of the due date, not only once it arrives", async () => {
    const { householdId, actor } = await household();
    await deadline(householdId, actor.userId, "2026-09-25");

    // Five days out is inside the week-long window.
    expect(await scanForReminders(new Date("2026-09-20T09:00:00Z"))).toMatchObject({ deadlines: 1 });
  });

  it("stays quiet while the deadline is still far off", async () => {
    const { householdId, actor } = await household();
    await deadline(householdId, actor.userId, "2026-12-31");

    expect(await scanForReminders(new Date("2026-09-20T09:00:00Z"))).toMatchObject({ deadlines: 0 });
  });

  it("announces a deadline once, not on every scan", async () => {
    const { householdId, actor } = await household();
    await deadline(householdId, actor.userId, "2026-09-25");

    await scanForReminders(new Date("2026-09-20T09:00:00Z"));
    await scanForReminders(new Date("2026-09-21T09:00:00Z"));
    await scanForReminders(new Date("2026-09-24T09:00:00Z"));

    expect(await db.select().from(outboxEvents)).toHaveLength(1);
  });

  it("re-arms when the deadline itself moves", async () => {
    const { householdId, actor } = await household();
    const row = await deadline(householdId, actor.userId, "2026-09-25");
    await scanForReminders(new Date("2026-09-20T09:00:00Z"));

    await db.update(deadlines).set({ dueOn: new Date("2026-09-28T00:00:00Z") }).where(eq(deadlines.id, row.id));
    await scanForReminders(new Date("2026-09-24T09:00:00Z"));

    expect(await db.select().from(outboxEvents)).toHaveLength(2);
  });

  it("ignores a deadline that has been met", async () => {
    const { householdId, actor } = await household();
    const row = await deadline(householdId, actor.userId, "2026-09-25");
    await db.update(deadlines).set({ metAt: new Date() }).where(eq(deadlines.id, row.id));

    expect(await scanForReminders(new Date("2026-09-20T09:00:00Z"))).toMatchObject({ deadlines: 0 });
  });
});

describe("reminders end to end", () => {
  it("goes from a passing date to a notification with no user action at all", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, FOLLOW_UP);

    // Nobody touches the app. Time simply passes.
    await scanForReminders(AFTER_FOLLOW_UP);
    await processOutbox();

    const inbox = await getNotifications(actor);
    expect(inbox.map((n) => n.type)).toEqual(["task.follow_up_due"]);
  });

  it("is safe to run the whole pipeline repeatedly", async () => {
    const { householdId, actor } = await household();
    await waitingTask(actor, householdId, FOLLOW_UP);

    for (let i = 0; i < 3; i++) {
      await scanForReminders(AFTER_FOLLOW_UP);
      await processOutbox();
    }

    expect(await getNotifications(actor)).toHaveLength(1);
  });
});

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
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
import { processOutbox } from "../../application/outbox/processOutbox";
import { emitOutboxEvent } from "../../application/outbox/emitOutboxEvent";
import { getNotifications, getUnreadNotificationCount } from "../../application/queries/notifications/getNotifications";
import { markNotificationsRead } from "../../application/commands/notifications/markNotificationsRead";
import type { Actor } from "../../application/policies/authorize";

/**
 * Transactional outbox and in-app notifications (ADR-004 / ADR-013),
 * against a real database. Requires DATABASE_URL to point at a disposable
 * development database.
 */

async function resetDatabase() {
  await db.execute(
    sql`truncate table ${notifications}, ${outboxEvents}, ${auditEvents}, ${deadlines}, ${taskPeople}, ${tasks}, ${inboxItems}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );
}

beforeEach(resetDatabase);
afterAll(resetDatabase);

/** Owner plus a second member who has their own login, to be assigned to. */
async function householdWithTwoMembers() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const owner: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };

  const benPerson = await addHouseholdMember(owner, household.id, {
    displayName: "Ben Adult",
    role: "ADULT",
    account: { email: "ben@example.test", temporaryPassword: "another long temp password" },
  });
  const ben: Actor = {
    userId: benPerson.accountUserId!,
    householdId: household.id,
    role: "ADULT",
    personIds: [benPerson.id],
  };

  return { householdId: household.id, owner, ben, benPersonId: benPerson.id, ownerPersonId: person.id };
}

async function plannedTask(actor: Actor, householdId: string, title = "Ring the dentist") {
  const item = await captureInboxItem(actor, householdId, { capturedText: title });
  return triageInboxItemToTask(actor, householdId, {
    inboxItemId: item.id,
    expectedVersion: item.version,
    title,
    priority: "NORMAL",
    aboutPersonIds: [],
  });
}

describe("outbox writes are transactional with the domain change", () => {
  it("emits task.assigned in the same transaction as the assignment", async () => {
    const { householdId, owner, ownerPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);

    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId });

    const events = await db.select().from(outboxEvents);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("task.assigned");
    expect(events[0].status).toBe("PENDING");
  });

  it("does not emit an event when a transition changes no owner", async () => {
    const { householdId, owner, ownerPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);
    const started = await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId });

    await db.delete(outboxEvents);
    await transitionTask(owner, householdId, task.id, started.version, { type: "COMPLETE" });

    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });
});

describe("outbox worker", () => {
  it("delivers an in-app notification to the assignee and marks the event processed", async () => {
    const { householdId, owner, ben, benPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);
    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId: benPersonId });

    const result = await processOutbox();
    expect(result).toMatchObject({ claimed: 1, processed: 1, failed: 0 });

    const benNotifications = await getNotifications(ben);
    expect(benNotifications).toHaveLength(1);
    expect(benNotifications[0].title).toBe("Ring the dentist");
    expect(benNotifications[0].resourceId).toBe(task.id);

    const [event] = await db.select().from(outboxEvents);
    expect(event.status).toBe("PROCESSED");
    expect(event.processedAt).not.toBeNull();
  });

  it("never notifies someone about their own action", async () => {
    const { householdId, owner, ownerPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);
    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId });

    await processOutbox();

    expect(await getNotifications(owner)).toHaveLength(0);
    // ...and the event is still processed successfully, not left pending.
    const [event] = await db.select().from(outboxEvents);
    expect(event.status).toBe("PROCESSED");
  });

  it("is idempotent: redelivering the same event produces one notification", async () => {
    const { householdId, owner, ben, benPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);
    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId: benPersonId });
    await processOutbox();

    // Simulate an at-least-once redelivery of the identical event.
    await db.update(outboxEvents).set({ status: "PENDING", processedAt: null });
    await processOutbox();

    expect(await getNotifications(ben)).toHaveLength(1);
  });

  it("processes nothing when no event is due, and reports an empty batch", async () => {
    await householdWithTwoMembers();
    expect(await processOutbox()).toMatchObject({ claimed: 0, processed: 0 });
  });

  it("retries a failing event with backoff, then gives up in a terminal FAILED state", async () => {
    const { householdId } = await householdWithTwoMembers();

    // An event type with no registered handler is permanently broken —
    // the worker must not retry it forever.
    await db.insert(outboxEvents).values({
      householdId,
      eventType: "does.not.exist",
      payload: {},
    });

    const result = await processOutbox(10);
    expect(result.failed).toBe(1);

    const [event] = await db.select().from(outboxEvents);
    expect(event.status).toBe("FAILED");
    expect(event.lastError).toContain("No handler registered");
    // The row survives for inspection rather than disappearing.
    expect(event.attempts).toBeGreaterThan(0);
  });

  it("leaves a future-dated event alone until it is due", async () => {
    const { householdId } = await householdWithTwoMembers();
    await db.insert(outboxEvents).values({
      householdId,
      eventType: "task.assigned",
      payload: {},
      nextAttemptAt: new Date(Date.now() + 60_000),
    });

    expect(await processOutbox()).toMatchObject({ claimed: 0 });
  });

  it("does not notify a person who has no login", async () => {
    const { householdId, owner } = await householdWithTwoMembers();
    const kid = await addHouseholdMember(owner, householdId, { displayName: "Kid", role: "CHILD" });
    const task = await plannedTask(owner, householdId);
    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId: kid.id });

    const result = await processOutbox();
    // A person with nowhere to receive it is a normal outcome, not a failure.
    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe("notification reading", () => {
  it("counts only the actor's own unread notifications", async () => {
    const { householdId, owner, ben, benPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);
    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId: benPersonId });
    await processOutbox();

    expect(await getUnreadNotificationCount(ben)).toBe(1);
    // The owner performed the action, so has nothing waiting.
    expect(await getUnreadNotificationCount(owner)).toBe(0);
  });

  it("refuses to let one member mark another member's notification read", async () => {
    const { householdId, owner, ben, benPersonId } = await householdWithTwoMembers();
    const task = await plannedTask(owner, householdId);
    await transitionTask(owner, householdId, task.id, task.version, { type: "START", ownerPersonId: benPersonId });
    await processOutbox();

    const [bensNotification] = await db.select().from(notifications).where(eq(notifications.userId, ben.userId));

    // The owner explicitly names Ben's notification id — the userId
    // predicate, not the id, is what decides (BOLA).
    const markedByOwner = await markNotificationsRead(owner, [bensNotification.id]);
    expect(markedByOwner).toBe(0);
    expect(await getUnreadNotificationCount(ben)).toBe(1);

    expect(await markNotificationsRead(ben)).toBe(1);
    expect(await getUnreadNotificationCount(ben)).toBe(0);
  });
});

describe("emitOutboxEvent", () => {
  it("accepts a transaction handle so the event cannot outlive a rolled-back change", async () => {
    const { householdId } = await householdWithTwoMembers();

    await expect(
      db.transaction(async (tx) => {
        await emitOutboxEvent(tx, householdId, {
          type: "task.assigned",
          payload: { taskId: crypto.randomUUID(), taskTitle: "x", assignedPersonId: crypto.randomUUID(), actorUserId: "u" },
        });
        throw new Error("domain change failed after the event was written");
      })
    ).rejects.toThrow();

    // Rolled back with the transaction: no orphaned side effect.
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });
});

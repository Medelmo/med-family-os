import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
  inboxItems,
  tasks,
} from "../../db/schema";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { captureInboxItem } from "../../application/commands/inbox/captureInboxItem";
import { discardInboxItem, triageInboxItemToTask } from "../../application/commands/inbox/triageInboxItem";
import { transitionTask, IllegalTransitionError } from "../../application/commands/tasks/transitionTask";
import { getInbox } from "../../application/queries/inbox/getInbox";
import { getTasks } from "../../application/queries/tasks/getTasks";
import { getAttention, getToday } from "../../application/queries/attention/getAttention";
import { ConflictError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";
import { resetDatabase } from "../support/database";

/**
 * Capture -> Triage -> Execute -> Follow up, against a real database
 * (docs/requirements/product-spec.md's primary journeys). Requires
 * DATABASE_URL to point at a disposable development database.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

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

describe("inbox capture and triage", () => {
  it("captures an item and lists it as untriaged", async () => {
    const { householdId, actor } = await household();
    await captureInboxItem(actor, householdId, { capturedText: "Ring the dentist about Lukas" });

    const inbox = await getInbox(actor, householdId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].capturedText).toBe("Ring the dentist about Lukas");
  });

  it("turns a capture into a planned task and records what it became", async () => {
    const { householdId, actor } = await household();
    const item = await captureInboxItem(actor, householdId, { capturedText: "Ring the dentist" });

    const task = await triageInboxItemToTask(actor, householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "Ring the dentist",
      priority: "NORMAL",
      nextAction: "Call during opening hours",
      aboutPersonIds: [],
    });

    // Triage is the decision that this is real work, so the task is
    // PLANNED rather than needing triage a second time.
    expect(task.status).toBe("PLANNED");

    const [triagedItem] = await db.select().from(inboxItems).where(sql`id = ${item.id}`);
    expect(triagedItem.status).toBe("TRIAGED");
    expect(triagedItem.triagedIntoType).toBe("task");
    expect(triagedItem.triagedIntoId).toBe(task.id);

    // and it leaves the inbox
    expect(await getInbox(actor, householdId)).toHaveLength(0);
  });

  it("refuses to triage the same item twice (optimistic concurrency)", async () => {
    const { householdId, actor } = await household();
    const item = await captureInboxItem(actor, householdId, { capturedText: "Ring the dentist" });

    await triageInboxItemToTask(actor, householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "Ring the dentist",
      priority: "NORMAL",
      aboutPersonIds: [],
    });

    await expect(
      triageInboxItemToTask(actor, householdId, {
        inboxItemId: item.id,
        expectedVersion: item.version,
        title: "Ring the dentist again",
        priority: "NORMAL",
        aboutPersonIds: [],
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await db.select().from(tasks)).toHaveLength(1);
  });

  it("archives a discarded item with a record rather than deleting it", async () => {
    const { householdId, actor } = await household();
    const item = await captureInboxItem(actor, householdId, { capturedText: "Never mind" });

    await discardInboxItem(actor, householdId, { inboxItemId: item.id, expectedVersion: item.version, reason: "handled" });

    expect(await getInbox(actor, householdId)).toHaveLength(0);
    const [row] = await db.select().from(inboxItems).where(sql`id = ${item.id}`);
    expect(row.status).toBe("DISCARDED");
    expect(row.discardReason).toBe("handled");
  });
});

describe("task lifecycle", () => {
  async function plannedTask() {
    const ctx = await household();
    const item = await captureInboxItem(ctx.actor, ctx.householdId, { capturedText: "Ring the dentist" });
    const task = await triageInboxItemToTask(ctx.actor, ctx.householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "Ring the dentist",
      priority: "NORMAL",
      aboutPersonIds: [],
    });
    return { ...ctx, task };
  }

  it("runs planned -> in progress -> completed and audits each step", async () => {
    const { householdId, actor, task, personId } = await plannedTask();

    const started = await transitionTask(actor, householdId, task.id, task.version, {
      type: "START",
      ownerPersonId: personId,
    });
    expect(started.status).toBe("IN_PROGRESS");

    const completed = await transitionTask(actor, householdId, task.id, started.version, { type: "COMPLETE" });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();

    const auditActions = (await db.select().from(auditEvents)).map((row) => row.action);
    expect(auditActions).toContain("task.started");
    expect(auditActions).toContain("task.completed");
  });

  it("rejects a transition the state machine does not allow", async () => {
    const { householdId, actor, task } = await plannedTask();
    await expect(
      transitionTask(actor, householdId, task.id, task.version, { type: "COMPLETE" })
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("rejects a stale version rather than silently overwriting a concurrent edit", async () => {
    const { householdId, actor, task, personId } = await plannedTask();
    await transitionTask(actor, householdId, task.id, task.version, { type: "START", ownerPersonId: personId });

    // Second device still holds the pre-START version.
    await expect(
      transitionTask(actor, householdId, task.id, task.version, { type: "COMPLETE" })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("requires a follow-up date before a task may wait", async () => {
    const { householdId, actor, task } = await plannedTask();
    await expect(
      transitionTask(actor, householdId, task.id, task.version, {
        type: "WAIT",
        waitingFor: "the clinic",
        followUpAt: null,
      })
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });
});

describe("attention and today projections", () => {
  async function taskDue(dueOn: Date | null, overrides: { nextAction?: string | null } = {}) {
    const ctx = await household();
    const item = await captureInboxItem(ctx.actor, ctx.householdId, { capturedText: "Renew the passport" });
    const task = await triageInboxItemToTask(ctx.actor, ctx.householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "Renew the passport",
      priority: "NORMAL",
      dueOn,
      // `in`, not `??`: the whole point of one caller is to pass an
      // explicit null, which `??` would quietly replace with the default.
      nextAction: "nextAction" in overrides ? overrides.nextAction : "Book an appointment",
      aboutPersonIds: [],
    });
    return { ...ctx, task };
  }

  it("surfaces an overdue task with an explanation, not just a score", async () => {
    const { householdId, actor } = await taskDue(new Date("2026-09-01T00:00:00Z"));
    const { items } = await getAttention(actor, householdId, new Date("2026-09-14T10:00:00Z"));

    expect(items).toHaveLength(1);
    expect(items[0].reasons.map((r) => r.code)).toContain("OVERDUE");
  });

  it("says nothing needs attention when nothing does", async () => {
    const { householdId, actor } = await taskDue(new Date("2026-12-31T00:00:00Z"));
    const { items } = await getAttention(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(items).toEqual([]);
  });

  it("flags an actionable task with no next action", async () => {
    const { householdId, actor } = await taskDue(null, { nextAction: null });
    const { items } = await getAttention(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(items[0].reasons.map((r) => r.code)).toContain("MISSING_NEXT_ACTION");
  });

  it("puts a task due today into Today, and keeps a future one out", async () => {
    const { householdId, actor } = await taskDue(new Date("2026-09-14T00:00:00Z"));
    const today = await getToday(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(today.dueToday.map((t) => t.title)).toEqual(["Renew the passport"]);

    const later = await getToday(actor, householdId, new Date("2026-09-01T10:00:00Z"));
    expect(later.dueToday).toEqual([]);
  });

  it("moves a waiting task into the waiting section once its follow-up arrives", async () => {
    const { householdId, actor, task } = await taskDue(null);
    await transitionTask(actor, householdId, task.id, task.version, {
      type: "WAIT",
      waitingFor: "the passport office",
      followUpAt: new Date("2026-09-10T00:00:00Z"),
    });

    const before = await getToday(actor, householdId, new Date("2026-09-05T10:00:00Z"));
    expect(before.waiting).toHaveLength(0);

    const after = await getToday(actor, householdId, new Date("2026-09-14T10:00:00Z"));
    expect(after.waiting.map((t) => t.waitingFor)).toEqual(["the passport office"]);
  });
});

describe("task authorization", () => {
  it("hides a task scoped to one person from a child who is not that person", async () => {
    const { householdId, actor, personId } = await household();

    const item = await captureInboxItem(actor, householdId, { capturedText: "Private matter" });
    await triageInboxItemToTask(actor, householdId, {
      inboxItemId: item.id,
      expectedVersion: item.version,
      title: "Private matter",
      priority: "NORMAL",
      aboutPersonIds: [personId],
    });

    const otherChild: Actor = {
      userId: "00000000-0000-0000-0000-0000000000ff",
      householdId,
      role: "CHILD",
      personIds: ["00000000-0000-0000-0000-0000000000ee"],
    };

    expect(await getTasks(otherChild, householdId)).toHaveLength(0);
    // ...while the person it concerns can see it.
    expect(await getTasks(actor, householdId)).toHaveLength(1);
  });
});

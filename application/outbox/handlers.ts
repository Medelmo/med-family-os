import { and, eq } from "drizzle-orm";
import { notifications, people } from "../../db/schema";
import type { Database, Transaction } from "../../infrastructure/db/client";
import type { OutboxEvent, OutboxEventType } from "./emitOutboxEvent";

type Handle = Database | Transaction;

export type OutboxHandler = (handle: Handle, householdId: string, payload: never) => Promise<void>;

type PayloadOf<T extends OutboxEventType> = Extract<OutboxEvent, { type: T }>["payload"];

/**
 * Resolves the account that should hear about something.
 *
 * Prefers whoever is accountable; falls back to whoever created the
 * record. Returning null is a normal outcome, not a failure — a person
 * without a login (a young child) or a record nobody owns simply has
 * nowhere to be told, and the item still shows up in Attention.
 */
async function resolveRecipient(
  handle: Handle,
  householdId: string,
  ownerPersonId: string | null,
  createdBy: string | null
): Promise<string | null> {
  if (ownerPersonId) {
    const [owner] = await handle
      .select({ accountUserId: people.accountUserId })
      .from(people)
      .where(and(eq(people.id, ownerPersonId), eq(people.householdId, householdId)))
      .limit(1);
    if (owner?.accountUserId) return owner.accountUserId;
  }
  return createdBy;
}

/**
 * Writes a notification, relying on the unique (householdId, dedupeKey)
 * index for idempotency rather than on the caller checking first.
 */
async function notify(
  handle: Handle,
  householdId: string,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string | null;
    resourceType: string;
    resourceId: string;
    dedupeKey: string;
  }
): Promise<void> {
  await handle.insert(notifications).values({ householdId, ...input }).onConflictDoNothing();
}

async function handleTaskAssigned(handle: Handle, householdId: string, payload: PayloadOf<"task.assigned">): Promise<void> {
  const [assignee] = await handle
    .select({ accountUserId: people.accountUserId })
    .from(people)
    .where(and(eq(people.id, payload.assignedPersonId), eq(people.householdId, householdId)))
    .limit(1);

  if (!assignee?.accountUserId) return;
  // Nobody needs telling about something they just did themselves.
  if (assignee.accountUserId === payload.actorUserId) return;

  await notify(handle, householdId, {
    userId: assignee.accountUserId,
    type: "task.assigned",
    title: payload.taskTitle,
    body: null,
    resourceType: "task",
    resourceId: payload.taskId,
    dedupeKey: `task.assigned:${payload.taskId}:${assignee.accountUserId}`,
  });
}

async function handleTaskFollowUpDue(
  handle: Handle,
  householdId: string,
  payload: PayloadOf<"task.follow_up_due">
): Promise<void> {
  const userId = await resolveRecipient(handle, householdId, payload.ownerPersonId, payload.createdBy);
  if (!userId) return;

  await notify(handle, householdId, {
    userId,
    type: "task.follow_up_due",
    title: payload.taskTitle,
    body: payload.waitingFor,
    resourceType: "task",
    resourceId: payload.taskId,
    // Keyed by the follow-up moment, not just the task: rescheduling the
    // follow-up should produce a new reminder, while a redelivery of the
    // same one must not.
    dedupeKey: `task.follow_up_due:${payload.taskId}:${payload.followUpAt}`,
  });
}

async function handleCaseFollowUpDue(
  handle: Handle,
  householdId: string,
  payload: PayloadOf<"case.follow_up_due">
): Promise<void> {
  const userId = await resolveRecipient(handle, householdId, payload.ownerPersonId, payload.createdBy);
  if (!userId) return;

  await notify(handle, householdId, {
    userId,
    type: "case.follow_up_due",
    title: payload.caseTitle,
    body: payload.waitingFor,
    resourceType: "case",
    resourceId: payload.caseId,
    dedupeKey: `case.follow_up_due:${payload.caseId}:${payload.followUpAt}`,
  });
}

async function handleReimbursementFollowUpDue(
  handle: Handle,
  householdId: string,
  payload: PayloadOf<"reimbursement.follow_up_due">
): Promise<void> {
  // A claim has no owning person, so there is only the creator to tell.
  if (!payload.createdBy) return;

  await notify(handle, householdId, {
    userId: payload.createdBy,
    type: "reimbursement.follow_up_due",
    title: payload.reimbursementTitle,
    body: payload.counterparty,
    resourceType: "reimbursement",
    resourceId: payload.reimbursementId,
    dedupeKey: `reimbursement.follow_up_due:${payload.reimbursementId}:${payload.followUpAt}`,
  });
}

async function handleDeadlineApproaching(
  handle: Handle,
  householdId: string,
  payload: PayloadOf<"deadline.approaching">
): Promise<void> {
  if (!payload.createdBy) return;

  await notify(handle, householdId, {
    userId: payload.createdBy,
    type: "deadline.approaching",
    title: payload.deadlineTitle,
    body: payload.dueOn,
    resourceType: "deadline",
    resourceId: payload.deadlineId,
    dedupeKey: `deadline.approaching:${payload.deadlineId}:${payload.dueOn}`,
  });
}

export const OUTBOX_HANDLERS: Record<OutboxEventType, OutboxHandler> = {
  "task.assigned": handleTaskAssigned as OutboxHandler,
  "task.follow_up_due": handleTaskFollowUpDue as OutboxHandler,
  "case.follow_up_due": handleCaseFollowUpDue as OutboxHandler,
  "reimbursement.follow_up_due": handleReimbursementFollowUpDue as OutboxHandler,
  "deadline.approaching": handleDeadlineApproaching as OutboxHandler,
};

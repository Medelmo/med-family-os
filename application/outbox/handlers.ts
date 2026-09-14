import { and, eq } from "drizzle-orm";
import { notifications, people } from "../../db/schema";
import type { Database, Transaction } from "../../infrastructure/db/client";
import type { OutboxEvent, OutboxEventType } from "./emitOutboxEvent";

export type OutboxHandler = (handle: Database | Transaction, householdId: string, payload: never) => Promise<void>;

/**
 * Turns "this person was made accountable for this task" into a
 * notification for their account, if they have one.
 *
 * CLAUDE.md §16: a notification should not merely say "Task updated" — it
 * carries the task's title and a link target so the recipient can act
 * without hunting for what changed.
 */
async function handleTaskAssigned(
  handle: Database | Transaction,
  householdId: string,
  payload: Extract<OutboxEvent, { type: "task.assigned" }>["payload"]
): Promise<void> {
  const [assignee] = await handle
    .select({ accountUserId: people.accountUserId, displayName: people.displayName })
    .from(people)
    .where(and(eq(people.id, payload.assignedPersonId), eq(people.householdId, householdId)))
    .limit(1);

  // A person without a login (a young child, a non-login family member)
  // has nowhere to receive this, and that is a normal outcome, not a
  // failure — the event is processed successfully with no notification.
  if (!assignee?.accountUserId) return;

  // Nobody needs telling about something they just did themselves.
  if (assignee.accountUserId === payload.actorUserId) return;

  await handle
    .insert(notifications)
    .values({
      householdId,
      userId: assignee.accountUserId,
      type: "task.assigned",
      title: payload.taskTitle,
      body: null,
      resourceType: "task",
      resourceId: payload.taskId,
      // Stable per (task, assignee): a redelivered event, or a second
      // assignment to the same person, cannot stack up duplicates.
      dedupeKey: `task.assigned:${payload.taskId}:${assignee.accountUserId}`,
    })
    // The unique index on (householdId, dedupeKey) is the real guarantee;
    // this turns the resulting conflict into a no-op so an at-least-once
    // retry is genuinely idempotent rather than an error.
    .onConflictDoNothing();
}

export const OUTBOX_HANDLERS: Record<OutboxEventType, OutboxHandler> = {
  "task.assigned": handleTaskAssigned as OutboxHandler,
};

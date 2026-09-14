import { outboxEvents } from "../../db/schema";
import type { Database, Transaction } from "../../infrastructure/db/client";

/**
 * Domain events this application publishes. A closed union rather than a
 * free string so a handler and an emitter cannot silently disagree about
 * an event name.
 */
export type OutboxEvent = {
  type: "task.assigned";
  payload: {
    taskId: string;
    taskTitle: string;
    assignedPersonId: string;
    /** Who performed the assignment — never notified about their own action. */
    actorUserId: string;
  };
};

export type OutboxEventType = OutboxEvent["type"];

/**
 * Writes an event in the caller's transaction (ADR-004).
 *
 * `handle` is required, not defaulted to the module-level `db`: an outbox
 * write that happens outside the domain transaction it belongs to defeats
 * the entire point of the pattern, and making the caller pass the
 * transaction makes that mistake hard to commit by accident.
 */
export async function emitOutboxEvent(handle: Database | Transaction, householdId: string, event: OutboxEvent): Promise<void> {
  await handle.insert(outboxEvents).values({
    householdId,
    eventType: event.type,
    payload: event.payload,
  });
}

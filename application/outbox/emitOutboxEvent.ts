import { outboxEvents } from "../../db/schema";
import type { Database, Transaction } from "../../infrastructure/db/client";

/**
 * Domain events this application publishes. A closed union rather than a
 * free string so a handler and an emitter cannot silently disagree about
 * an event name.
 */
export type OutboxEvent =
  | {
      type: "task.assigned";
      payload: {
        taskId: string;
        taskTitle: string;
        assignedPersonId: string;
        /** Who performed the assignment — never notified about their own action. */
        actorUserId: string;
      };
    }
  // The three below are emitted by application/reminders/scanForReminders.ts
  // rather than by a user action: nobody acts when a date arrives, which is
  // exactly why they need announcing.
  | {
      type: "task.follow_up_due";
      payload: {
        taskId: string;
        taskTitle: string;
        waitingFor: string | null;
        ownerPersonId: string | null;
        createdBy: string | null;
        followUpAt: string;
      };
    }
  | {
      type: "case.follow_up_due";
      payload: {
        caseId: string;
        caseTitle: string;
        waitingFor: string | null;
        ownerPersonId: string | null;
        createdBy: string | null;
        followUpAt: string;
      };
    }
  | {
      type: "reimbursement.follow_up_due";
      payload: {
        reimbursementId: string;
        reimbursementTitle: string;
        counterparty: string | null;
        createdBy: string | null;
        followUpAt: string;
        /**
         * Deliberately no amount. A notification is stored and rendered in
         * places the claim's own authorization does not reach, and
         * CLAUDE.md §12 keeps sensitive data out of those paths — the
         * title and counterparty are enough to act on.
         */
      };
    }
  | {
      type: "deadline.approaching";
      payload: {
        deadlineId: string;
        deadlineTitle: string;
        dueOn: string;
        createdBy: string | null;
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

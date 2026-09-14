import { and, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { tasks, taskPeople } from "../../../db/schema";
import { applyTaskCommand, type Task, type TaskCommand } from "../../../domain/tasks/task";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { emitOutboxEvent } from "../../outbox/emitOutboxEvent";
import { authorizeTaskAccess } from "../../policies/task";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class IllegalTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IllegalTransitionError";
    this.code = code;
  }
}

/**
 * The only path by which a task's status changes.
 *
 * Structure matters as much as behaviour here: the *decision* lives in the
 * pure domain function (domain/tasks/task.ts), this command owns the
 * transaction, the authorization check, the optimistic-concurrency guard
 * and the audit write. docs/domain/erd.md: "state transitions are enforced
 * in application commands and tested."
 */
export async function transitionTask(
  actor: Actor,
  householdId: string,
  taskId: string,
  expectedVersion: number,
  command: TaskCommand,
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.householdId, householdId)))
      .limit(1);

    if (!row) throw new NotFoundError("Task not found.");

    const scopeRows = await tx.select({ personId: taskPeople.personId }).from(taskPeople).where(eq(taskPeople.taskId, taskId));

    const authorized = authorizeTaskAccess(actor, "update", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: scopeRows.map((s) => s.personId),
    });
    if (!authorized) throw new AuthorizationError("Not permitted to change this task.");

    const result = applyTaskCommand(row as unknown as Task, command, now);
    if (!result.ok) {
      throw new IllegalTransitionError(result.rejection.code, result.rejection.message);
    }

    const updated = await tx
      .update(tasks)
      .set({ ...result.transition.patch, updatedAt: now, version: row.version + 1 })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This task was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: result.transition.auditAction,
        resourceType: "task",
        resourceId: taskId,
        // The status pair, not the task's contents — audit rows are read by
        // more people than the task itself may be.
        metadata: { from: row.status, to: result.transition.status },
      },
      tx
    );

    // Emitted in this same transaction (ADR-004): the event cannot exist
    // without the assignment, nor the assignment without the event. Only
    // when ownership actually changed — re-running START on an
    // already-owned task should not re-notify.
    const newOwner = updated[0].ownerPersonId;
    if (newOwner && newOwner !== row.ownerPersonId) {
      await emitOutboxEvent(tx, householdId, {
        type: "task.assigned",
        payload: {
          taskId,
          taskTitle: updated[0].title,
          assignedPersonId: newOwner,
          actorUserId: actor.userId,
        },
      });
    }

    return updated[0];
  });
}

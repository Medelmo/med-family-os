import type { Priority, Sensitivity, Visibility } from "../shared/types";

export type TaskStatus = "INBOX" | "PLANNED" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "CANCELLED";

export interface Task {
  id: string;
  householdId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  /** Who is accountable (domain-model.md: ownership is not authorization). */
  ownerPersonId: string | null;
  dueOn: Date | null;
  /**
   * The single concrete thing to do next. product-spec.md calls the absence
   * of this out as the reason waiting lists "become a graveyard".
   */
  nextAction: string | null;
  waitingFor: string | null;
  waitingSince: Date | null;
  followUpAt: Date | null;
  waitingIndefinite: boolean;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The transitions docs/domain/state-machines.md permits, verbatim, plus
 * COMPLETED -> PLANNED, which that document implies rather than lists
 * ("Reopening a completed task creates an audit event" — impossible unless
 * reopening is a transition).
 *
 * Deliberately *not* included, even though a user might reach for them:
 * WAITING -> COMPLETED and WAITING -> CANCELLED. The documented path out of
 * WAITING is back through IN_PROGRESS. Expanding the state machine beyond
 * what the domain doc sanctions would be exactly the "free-form status
 * updates create impossible states" failure that document exists to
 * prevent, so the extra hop stays until a product owner decides otherwise
 * (recorded as an open question in docs/audit/ARCHITECTURE_AUDIT.md).
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  INBOX: ["PLANNED", "CANCELLED"],
  PLANNED: ["IN_PROGRESS", "WAITING", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "WAITING", "CANCELLED"],
  WAITING: ["IN_PROGRESS"],
  COMPLETED: ["PLANNED"],
  CANCELLED: [],
};

export type TaskCommand =
  | { type: "PLAN"; dueOn?: Date | null; nextAction?: string | null }
  | { type: "START"; ownerPersonId: string }
  | { type: "WAIT"; waitingFor: string; followUpAt: Date | null; indefinite?: boolean }
  | { type: "RESUME"; ownerPersonId?: string }
  | { type: "COMPLETE" }
  | { type: "CANCEL"; reason?: string | null }
  | { type: "REOPEN" };

export type TaskTransitionRejection =
  | { code: "ILLEGAL_TRANSITION"; message: string }
  | { code: "OWNER_REQUIRED"; message: string }
  | { code: "FOLLOW_UP_REQUIRED"; message: string };

export interface TaskTransition {
  status: TaskStatus;
  patch: Partial<Task>;
  /** Recorded by the caller via application/audit/recordAuditEvent. */
  auditAction: string;
}

export type TaskTransitionResult = { ok: true; transition: TaskTransition } | { ok: false; rejection: TaskTransitionRejection };

function targetStatusFor(command: TaskCommand): TaskStatus {
  switch (command.type) {
    case "PLAN":
    case "REOPEN":
      return "PLANNED";
    case "START":
    case "RESUME":
      return "IN_PROGRESS";
    case "WAIT":
      return "WAITING";
    case "COMPLETE":
      return "COMPLETED";
    case "CANCEL":
      return "CANCELLED";
  }
}

/**
 * Pure transition function: the single place a task's status may change.
 * Returns the patch to persist rather than mutating, so the caller owns the
 * transaction, the optimistic-concurrency version check, and the audit
 * write (CLAUDE.md §7: every transition needs allowed previous states, an
 * actor, a timestamp, a reason where appropriate, and auditability).
 */
export function applyTaskCommand(task: Task, command: TaskCommand, now: Date): TaskTransitionResult {
  const target = targetStatusFor(command);

  if (!ALLOWED_TRANSITIONS[task.status].includes(target)) {
    return {
      ok: false,
      rejection: {
        code: "ILLEGAL_TRANSITION",
        message: `A task cannot go from ${task.status} to ${target}.`,
      },
    };
  }

  switch (command.type) {
    case "PLAN":
      return {
        ok: true,
        transition: {
          status: "PLANNED",
          patch: {
            status: "PLANNED",
            dueOn: command.dueOn ?? task.dueOn,
            nextAction: command.nextAction ?? task.nextAction,
          },
          auditAction: "task.planned",
        },
      };

    case "START":
    case "RESUME": {
      // state-machines.md: "IN_PROGRESS requires an owner."
      const ownerPersonId = command.type === "START" ? command.ownerPersonId : (command.ownerPersonId ?? task.ownerPersonId);
      if (!ownerPersonId) {
        return {
          ok: false,
          rejection: { code: "OWNER_REQUIRED", message: "A task in progress needs an owner." },
        };
      }
      return {
        ok: true,
        transition: {
          status: "IN_PROGRESS",
          patch: {
            status: "IN_PROGRESS",
            ownerPersonId,
            // Leaving WAITING clears the waiting context so a stale
            // waitingFor/followUpAt can't keep feeding the attention rules.
            waitingFor: null,
            waitingSince: null,
            followUpAt: null,
            waitingIndefinite: false,
          },
          auditAction: command.type === "START" ? "task.started" : "task.resumed",
        },
      };
    }

    case "WAIT": {
      // state-machines.md: "WAITING requires waitingFor + followUpAt unless
      // explicitly marked indefinite." The escape hatch is explicit on
      // purpose — an accidental indefinite wait is how items disappear.
      const indefinite = command.indefinite === true;
      if (!indefinite && !command.followUpAt) {
        return {
          ok: false,
          rejection: {
            code: "FOLLOW_UP_REQUIRED",
            message: "A waiting task needs a follow-up date, or must be marked as waiting indefinitely.",
          },
        };
      }
      return {
        ok: true,
        transition: {
          status: "WAITING",
          patch: {
            status: "WAITING",
            waitingFor: command.waitingFor,
            waitingSince: now,
            followUpAt: indefinite ? null : command.followUpAt,
            waitingIndefinite: indefinite,
          },
          auditAction: "task.waiting",
        },
      };
    }

    case "COMPLETE":
      // state-machines.md: "COMPLETED requires completion timestamp."
      return {
        ok: true,
        transition: {
          status: "COMPLETED",
          patch: { status: "COMPLETED", completedAt: now, waitingIndefinite: false },
          auditAction: "task.completed",
        },
      };

    case "CANCEL":
      return {
        ok: true,
        transition: {
          status: "CANCELLED",
          patch: { status: "CANCELLED", cancelledAt: now, cancelReason: command.reason ?? null },
          auditAction: "task.cancelled",
        },
      };

    case "REOPEN":
      // state-machines.md singles this out as audit-worthy, which is why it
      // gets its own action name rather than reusing "task.planned".
      return {
        ok: true,
        transition: {
          status: "PLANNED",
          patch: { status: "PLANNED", completedAt: null },
          auditAction: "task.reopened",
        },
      };
  }
}

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"];

export function isOpen(status: TaskStatus): boolean {
  return OPEN_TASK_STATUSES.includes(status);
}

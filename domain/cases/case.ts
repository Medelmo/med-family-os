import type { Priority, Sensitivity, Visibility } from "../shared/types";

export type CaseStatus = "DRAFT" | "ACTIVE" | "WAITING" | "BLOCKED" | "COMPLETED" | "CANCELLED" | "ARCHIVED";

export interface Case {
  id: string;
  householdId: string;
  title: string;
  description: string | null;
  status: CaseStatus;
  priority: Priority;
  ownerPersonId: string | null;
  nextAction: string | null;

  // WAITING context (docs/domain/state-machines.md). `waitingNoFollowUpReason`
  // is the explicit escape hatch the doc allows instead of a follow-up date —
  // explicit, because an accidental open-ended wait is precisely how a
  // waiting list becomes a graveyard.
  waitingFor: string | null;
  waitingSince: Date | null;
  followUpAt: Date | null;
  waitingNoFollowUpReason: string | null;
  /** e.g. an authority's file number, so the wait can be chased. */
  externalReference: string | null;

  blockedReason: string | null;

  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  archivedAt: Date | null;

  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Verbatim from docs/domain/state-machines.md, as reaffirmed by ADR-007:
 *
 *   DRAFT -> ACTIVE -> WAITING -> ACTIVE -> COMPLETED
 *   ACTIVE -> BLOCKED -> ACTIVE
 *   DRAFT/ACTIVE/WAITING/BLOCKED -> CANCELLED
 *   COMPLETED -> ARCHIVED
 *
 * Two absences are deliberate:
 * - No COMPLETED -> ACTIVE. Tasks get a reopen edge because
 *   state-machines.md explicitly mentions reopening one; it says no such
 *   thing about cases, and inventing it would be exactly the free-form
 *   status drift that document exists to prevent.
 * - No WAITING/BLOCKED -> COMPLETED. The documented route out of either is
 *   back through ACTIVE. (Note this differs from Task, where CANCELLED is
 *   *not* reachable from WAITING — the two machines are genuinely
 *   different, and each follows its own documented shape rather than being
 *   made superficially symmetric.)
 */
const ALLOWED_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["WAITING", "BLOCKED", "COMPLETED", "CANCELLED"],
  WAITING: ["ACTIVE", "CANCELLED"],
  BLOCKED: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: [],
  ARCHIVED: [],
};

export type CaseCommand =
  | { type: "ACTIVATE"; nextAction?: string | null }
  | {
      type: "WAIT";
      waitingFor: string;
      followUpAt: Date | null;
      noFollowUpReason?: string | null;
      externalReference?: string | null;
    }
  | { type: "BLOCK"; reason: string }
  | { type: "RESUME"; nextAction?: string | null }
  | { type: "COMPLETE" }
  | { type: "CANCEL"; reason?: string | null }
  | { type: "ARCHIVE" };

export type CaseTransitionRejection =
  | { code: "ILLEGAL_TRANSITION"; message: string }
  | { code: "FOLLOW_UP_REQUIRED"; message: string }
  | { code: "BLOCKING_REASON_REQUIRED"; message: string };

export interface CaseTransition {
  status: CaseStatus;
  patch: Partial<Case>;
  auditAction: string;
  /** Human-readable line for the case timeline (CaseEvent). */
  timelineSummary: string;
}

export type CaseTransitionResult =
  | { ok: true; transition: CaseTransition }
  | { ok: false; rejection: CaseTransitionRejection };

function targetStatusFor(command: CaseCommand): CaseStatus {
  switch (command.type) {
    case "ACTIVATE":
    case "RESUME":
      return "ACTIVE";
    case "WAIT":
      return "WAITING";
    case "BLOCK":
      return "BLOCKED";
    case "COMPLETE":
      return "COMPLETED";
    case "CANCEL":
      return "CANCELLED";
    case "ARCHIVE":
      return "ARCHIVED";
  }
}

/** Clears WAITING/BLOCKED context so stale values cannot keep feeding attention. */
const CLEARED_STALL_CONTEXT = {
  waitingFor: null,
  waitingSince: null,
  followUpAt: null,
  waitingNoFollowUpReason: null,
  blockedReason: null,
} satisfies Partial<Case>;

/**
 * Pure transition function — the single place a case's status may change.
 * Returns the patch to persist plus the audit action and timeline line,
 * leaving the transaction, authorization and concurrency check to the
 * application command (CLAUDE.md §7).
 */
export function applyCaseCommand(kase: Case, command: CaseCommand, now: Date): CaseTransitionResult {
  const target = targetStatusFor(command);

  if (!ALLOWED_TRANSITIONS[kase.status].includes(target)) {
    return {
      ok: false,
      rejection: { code: "ILLEGAL_TRANSITION", message: `A case cannot go from ${kase.status} to ${target}.` },
    };
  }

  switch (command.type) {
    case "ACTIVATE":
    case "RESUME": {
      const isResume = command.type === "RESUME";
      return {
        ok: true,
        transition: {
          status: "ACTIVE",
          patch: {
            status: "ACTIVE",
            nextAction: command.nextAction ?? kase.nextAction,
            ...CLEARED_STALL_CONTEXT,
          },
          auditAction: isResume ? "case.resumed" : "case.activated",
          timelineSummary: isResume ? "Picked the case back up" : "Case opened",
        },
      };
    }

    case "WAIT": {
      // state-machines.md: WAITING requires waitingFor, waitingSince, and
      // "followUpAt or explicit no-follow-up reason".
      const reason = command.noFollowUpReason?.trim();
      if (!command.followUpAt && !reason) {
        return {
          ok: false,
          rejection: {
            code: "FOLLOW_UP_REQUIRED",
            message: "A waiting case needs a follow-up date, or a stated reason why it has none.",
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
            followUpAt: command.followUpAt ?? null,
            waitingNoFollowUpReason: command.followUpAt ? null : (reason ?? null),
            externalReference: command.externalReference ?? kase.externalReference,
            blockedReason: null,
          },
          auditAction: "case.waiting",
          timelineSummary: `Waiting for ${command.waitingFor}`,
        },
      };
    }

    case "BLOCK": {
      // state-machines.md: "BLOCKED requires a blocking reason."
      const reason = command.reason.trim();
      if (!reason) {
        return {
          ok: false,
          rejection: { code: "BLOCKING_REASON_REQUIRED", message: "Say what is blocking the case." },
        };
      }
      return {
        ok: true,
        transition: {
          status: "BLOCKED",
          patch: { status: "BLOCKED", blockedReason: reason, waitingFor: null, waitingSince: null, followUpAt: null },
          auditAction: "case.blocked",
          timelineSummary: `Blocked: ${reason}`,
        },
      };
    }

    case "COMPLETE":
      return {
        ok: true,
        transition: {
          status: "COMPLETED",
          patch: { status: "COMPLETED", completedAt: now, ...CLEARED_STALL_CONTEXT },
          auditAction: "case.completed",
          timelineSummary: "Case resolved",
        },
      };

    case "CANCEL":
      return {
        ok: true,
        transition: {
          status: "CANCELLED",
          patch: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelReason: command.reason ?? null,
            ...CLEARED_STALL_CONTEXT,
          },
          auditAction: "case.cancelled",
          timelineSummary: command.reason ? `Case dropped: ${command.reason}` : "Case dropped",
        },
      };

    case "ARCHIVE":
      return {
        ok: true,
        transition: {
          status: "ARCHIVED",
          patch: { status: "ARCHIVED", archivedAt: now },
          auditAction: "case.archived",
          timelineSummary: "Case archived",
        },
      };
  }
}

export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ["DRAFT", "ACTIVE", "WAITING", "BLOCKED"];

export function isCaseOpen(status: CaseStatus): boolean {
  return OPEN_CASE_STATUSES.includes(status);
}

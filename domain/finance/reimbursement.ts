import type { Sensitivity, Visibility } from "../shared/types";

export type ReimbursementStatus =
  | "PLANNED"
  | "SUBMITTED"
  | "WAITING"
  | "APPROVED"
  | "PARTIALLY_REIMBURSED"
  | "PAID"
  | "REJECTED"
  | "COMPLETED"
  | "CANCELLED";

export interface Reimbursement {
  id: string;
  householdId: string;
  title: string;
  status: ReimbursementStatus;
  /** Who the claim is against — an insurer, an employer, a public office. */
  counterparty: string | null;
  /** Their file/claim number, so a wait can actually be chased. */
  externalReference: string | null;

  currency: string;
  /** What is being claimed, in minor units. Derived from the linked expenses at submission. */
  claimedAmountMinor: number;
  /** What they agreed to pay, when they say so before paying it. */
  approvedAmountMinor: number | null;
  /** Cumulative money actually received. */
  reimbursedAmountMinor: number;

  submittedAt: Date | null;
  waitingSince: Date | null;
  followUpAt: Date | null;
  waitingNoFollowUpReason: string | null;
  /** Mirrors task/case: lets the reminder scan re-arm when the date moves. */
  followUpNotifiedAt: Date | null;

  decidedAt: Date | null;
  rejectionReason: string | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;

  notes: string | null;

  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * docs/domain/state-machines.md gives:
 *
 *   PLANNED -> SUBMITTED -> WAITING -> APPROVED -> PAID -> COMPLETED
 *   SUBMITTED -> REJECTED
 *   APPROVED -> PARTIALLY_REIMBURSED
 *   PARTIALLY_REIMBURSED -> PAID
 *   Any open state -> CANCELLED where business rules allow.
 *
 * Two things that document leaves open are decided here and recorded in
 * ADR-015, and state-machines.md has been amended to match rather than
 * left to disagree with the code:
 *
 * 1. **WAITING -> REJECTED is added.** The document only allows refusal
 *    from SUBMITTED. But WAITING is precisely the state a submitted claim
 *    sits in while the counterparty decides, so a refusal almost always
 *    arrives while WAITING — the common case would otherwise have no legal
 *    path at all, and the household would have to falsify the record to
 *    close it. "SUBMITTED -> REJECTED" is read as "a claim that has been
 *    submitted can be refused", and WAITING is a submitted claim.
 *
 * 2. **"Any open state" is enumerated** as PLANNED, SUBMITTED, WAITING,
 *    APPROVED and PARTIALLY_REIMBURSED. PAID is excluded on purpose: money
 *    has arrived, and cancelling would make the record state something
 *    untrue. A PAID claim is closed with COMPLETED.
 *
 * REJECTED is terminal. An appeal is a new claim rather than a resurrected
 * one, so the original record keeps saying what actually happened — the
 * same reasoning that denies a case a reopen edge (ADR-007).
 */
const ALLOWED_TRANSITIONS: Record<ReimbursementStatus, readonly ReimbursementStatus[]> = {
  PLANNED: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["WAITING", "REJECTED", "CANCELLED"],
  WAITING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PARTIALLY_REIMBURSED", "PAID", "CANCELLED"],
  PARTIALLY_REIMBURSED: ["PAID", "CANCELLED"],
  PAID: ["COMPLETED"],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export type ReimbursementCommand =
  | { type: "SUBMIT"; counterparty: string; externalReference?: string | null }
  | { type: "WAIT"; followUpAt: Date | null; noFollowUpReason?: string | null }
  | { type: "APPROVE"; approvedAmountMinor?: number | null }
  | { type: "RECORD_PART_PAYMENT"; reimbursedAmountMinor: number }
  | { type: "RECORD_FULL_PAYMENT"; reimbursedAmountMinor: number }
  | { type: "REJECT"; reason: string }
  | { type: "COMPLETE" }
  | { type: "CANCEL"; reason?: string | null };

export type ReimbursementRejection =
  | { code: "ILLEGAL_TRANSITION"; message: string }
  | { code: "COUNTERPARTY_REQUIRED"; message: string }
  | { code: "FOLLOW_UP_REQUIRED"; message: string }
  | { code: "REJECTION_REASON_REQUIRED"; message: string }
  | { code: "NOTHING_TO_CLAIM"; message: string }
  | { code: "AMOUNT_INVALID"; message: string };

export interface ReimbursementTransition {
  status: ReimbursementStatus;
  patch: Partial<Reimbursement>;
  auditAction: string;
  timelineSummary: string;
}

export type ReimbursementTransitionResult =
  | { ok: true; transition: ReimbursementTransition }
  | { ok: false; rejection: ReimbursementRejection };

function targetStatusFor(command: ReimbursementCommand): ReimbursementStatus {
  switch (command.type) {
    case "SUBMIT":
      return "SUBMITTED";
    case "WAIT":
      return "WAITING";
    case "APPROVE":
      return "APPROVED";
    case "RECORD_PART_PAYMENT":
      return "PARTIALLY_REIMBURSED";
    case "RECORD_FULL_PAYMENT":
      return "PAID";
    case "REJECT":
      return "REJECTED";
    case "COMPLETE":
      return "COMPLETED";
    case "CANCEL":
      return "CANCELLED";
  }
}

/** Waiting context is cleared on every exit from WAITING, so a stale follow-up cannot keep feeding Attention. */
const CLEARED_WAITING = {
  waitingSince: null,
  followUpAt: null,
  waitingNoFollowUpReason: null,
} satisfies Partial<Reimbursement>;

export function applyReimbursementCommand(
  claim: Reimbursement,
  command: ReimbursementCommand,
  now: Date
): ReimbursementTransitionResult {
  const target = targetStatusFor(command);

  if (!ALLOWED_TRANSITIONS[claim.status].includes(target)) {
    return {
      ok: false,
      rejection: {
        code: "ILLEGAL_TRANSITION",
        message: `A reimbursement cannot go from ${claim.status} to ${target}.`,
      },
    };
  }

  switch (command.type) {
    case "SUBMIT": {
      // A claim submitted to nobody in particular cannot be chased, and
      // chasing is the entire point of tracking one.
      const counterparty = command.counterparty.trim();
      if (!counterparty) {
        return {
          ok: false,
          rejection: { code: "COUNTERPARTY_REQUIRED", message: "Say who the claim was submitted to." },
        };
      }
      // The claimed amount is the sum of the expenses attached to the
      // claim (see linkExpenseToReimbursement), so a zero claim is one
      // with nothing attached. Submitting it would produce a record that
      // can be chased but never settled.
      if (claim.claimedAmountMinor <= 0) {
        return {
          ok: false,
          rejection: { code: "NOTHING_TO_CLAIM", message: "Attach at least one expense before submitting a claim." },
        };
      }
      return {
        ok: true,
        transition: {
          status: "SUBMITTED",
          patch: {
            status: "SUBMITTED",
            counterparty,
            externalReference: command.externalReference?.trim() || claim.externalReference,
            submittedAt: now,
          },
          auditAction: "reimbursement.submitted",
          timelineSummary: `Submitted to ${counterparty}`,
        },
      };
    }

    case "WAIT": {
      // The same rule as a waiting case: a date, or an explicit statement
      // that there is none. An unresolved reimbursement is one of the
      // attention triggers product-spec.md names, and it can only fire if
      // the wait carries something to measure.
      const reason = command.noFollowUpReason?.trim();
      if (!command.followUpAt && !reason) {
        return {
          ok: false,
          rejection: {
            code: "FOLLOW_UP_REQUIRED",
            message: "A waiting claim needs a date to chase it, or a stated reason why it has none.",
          },
        };
      }
      return {
        ok: true,
        transition: {
          status: "WAITING",
          patch: {
            status: "WAITING",
            waitingSince: claim.waitingSince ?? now,
            followUpAt: command.followUpAt ?? null,
            waitingNoFollowUpReason: command.followUpAt ? null : (reason ?? null),
            followUpNotifiedAt: null,
          },
          auditAction: "reimbursement.waiting",
          timelineSummary: command.followUpAt
            ? `Waiting on ${claim.counterparty ?? "the counterparty"}`
            : `Waiting on ${claim.counterparty ?? "the counterparty"} — ${reason}`,
        },
      };
    }

    case "APPROVE": {
      const approved = command.approvedAmountMinor ?? null;
      if (approved !== null && !isUsableAmount(approved)) {
        return { ok: false, rejection: { code: "AMOUNT_INVALID", message: "An approved amount must be positive." } };
      }
      return {
        ok: true,
        transition: {
          status: "APPROVED",
          patch: { status: "APPROVED", approvedAmountMinor: approved, decidedAt: now, ...CLEARED_WAITING },
          auditAction: "reimbursement.approved",
          timelineSummary: "Approved",
        },
      };
    }

    case "RECORD_PART_PAYMENT": {
      const received = command.reimbursedAmountMinor;
      if (!isUsableAmount(received)) {
        return { ok: false, rejection: { code: "AMOUNT_INVALID", message: "A payment must be positive." } };
      }
      // A "partial" payment that covers the whole claim is not partial. It
      // would leave the record in a state whose own name contradicts its
      // numbers, so it is refused rather than quietly reinterpreted.
      if (received >= claim.claimedAmountMinor) {
        return {
          ok: false,
          rejection: {
            code: "AMOUNT_INVALID",
            message: "That covers the whole claim — record it as the final payment instead.",
          },
        };
      }
      return {
        ok: true,
        transition: {
          status: "PARTIALLY_REIMBURSED",
          patch: { status: "PARTIALLY_REIMBURSED", reimbursedAmountMinor: received, ...CLEARED_WAITING },
          auditAction: "reimbursement.partially_reimbursed",
          timelineSummary: "Part of the claim was paid",
        },
      };
    }

    case "RECORD_FULL_PAYMENT": {
      const received = command.reimbursedAmountMinor;
      if (!isUsableAmount(received)) {
        return { ok: false, rejection: { code: "AMOUNT_INVALID", message: "A payment must be positive." } };
      }
      // Deliberately not required to equal the claim: insurers routinely
      // pay less than was asked for, and PAID means "no more is coming",
      // not "we got everything".
      return {
        ok: true,
        transition: {
          status: "PAID",
          patch: { status: "PAID", reimbursedAmountMinor: received, paidAt: now, ...CLEARED_WAITING },
          auditAction: "reimbursement.paid",
          timelineSummary: "Paid",
        },
      };
    }

    case "REJECT": {
      const reason = command.reason.trim();
      if (!reason) {
        return {
          ok: false,
          rejection: { code: "REJECTION_REASON_REQUIRED", message: "Record why the claim was refused." },
        };
      }
      return {
        ok: true,
        transition: {
          status: "REJECTED",
          patch: { status: "REJECTED", rejectionReason: reason, decidedAt: now, ...CLEARED_WAITING },
          auditAction: "reimbursement.rejected",
          timelineSummary: `Refused: ${reason}`,
        },
      };
    }

    case "COMPLETE":
      return {
        ok: true,
        transition: {
          status: "COMPLETED",
          patch: { status: "COMPLETED", completedAt: now },
          auditAction: "reimbursement.completed",
          timelineSummary: "Closed",
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
            cancelReason: command.reason?.trim() || null,
            ...CLEARED_WAITING,
          },
          auditAction: "reimbursement.cancelled",
          timelineSummary: command.reason ? `Dropped: ${command.reason}` : "Dropped",
        },
      };
  }
}

function isUsableAmount(amountMinor: number): boolean {
  return Number.isSafeInteger(amountMinor) && amountMinor > 0;
}

/**
 * Claims still owed something, which is what "unresolved reimbursement"
 * means to the attention rules. PAID is excluded: the money arrived, and
 * only the household's own bookkeeping remains.
 */
export const OPEN_REIMBURSEMENT_STATUSES: readonly ReimbursementStatus[] = [
  "PLANNED",
  "SUBMITTED",
  "WAITING",
  "APPROVED",
  "PARTIALLY_REIMBURSED",
];

export function isReimbursementOpen(status: ReimbursementStatus): boolean {
  return OPEN_REIMBURSEMENT_STATUSES.includes(status);
}

/** Still owed, in minor units — never negative, even if they overpaid. */
export function outstandingMinor(claim: Pick<Reimbursement, "claimedAmountMinor" | "reimbursedAmountMinor">): number {
  return Math.max(0, claim.claimedAmountMinor - claim.reimbursedAmountMinor);
}

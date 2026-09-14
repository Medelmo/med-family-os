import { describe, expect, it } from "vitest";
import {
  applyReimbursementCommand,
  isReimbursementOpen,
  outstandingMinor,
  type Reimbursement,
  type ReimbursementCommand,
  type ReimbursementStatus,
} from "../../../domain/finance/reimbursement";

const NOW = new Date("2026-03-10T09:00:00Z");

function claim(overrides: Partial<Reimbursement> = {}): Reimbursement {
  return {
    id: "r1",
    householdId: "h1",
    title: "Physio, January",
    status: "PLANNED",
    counterparty: null,
    externalReference: null,
    currency: "EUR",
    claimedAmountMinor: 12_000,
    approvedAmountMinor: null,
    reimbursedAmountMinor: 0,
    submittedAt: null,
    waitingSince: null,
    followUpAt: null,
    waitingNoFollowUpReason: null,
    followUpNotifiedAt: null,
    decidedAt: null,
    rejectionReason: null,
    paidAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    notes: null,
    visibility: "HOUSEHOLD",
    sensitivity: "SENSITIVE",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function apply(status: ReimbursementStatus, command: ReimbursementCommand, overrides: Partial<Reimbursement> = {}) {
  return applyReimbursementCommand(claim({ status, ...overrides }), command, NOW);
}

const SUBMIT: ReimbursementCommand = { type: "SUBMIT", counterparty: "Krankenkasse" };
const WAIT: ReimbursementCommand = { type: "WAIT", followUpAt: new Date("2026-03-24T09:00:00Z") };
const APPROVE: ReimbursementCommand = { type: "APPROVE" };
const PAY: ReimbursementCommand = { type: "RECORD_FULL_PAYMENT", reimbursedAmountMinor: 12_000 };
const PART: ReimbursementCommand = { type: "RECORD_PART_PAYMENT", reimbursedAmountMinor: 5_000 };
const REJECT: ReimbursementCommand = { type: "REJECT", reason: "Not covered by the policy" };
const COMPLETE: ReimbursementCommand = { type: "COMPLETE" };
const CANCEL: ReimbursementCommand = { type: "CANCEL" };

describe("the documented happy path", () => {
  // docs/domain/state-machines.md:
  //   PLANNED -> SUBMITTED -> WAITING -> APPROVED -> PAID -> COMPLETED
  it("walks PLANNED -> SUBMITTED -> WAITING -> APPROVED -> PAID -> COMPLETED", () => {
    const steps: Array<[ReimbursementStatus, ReimbursementCommand, ReimbursementStatus]> = [
      ["PLANNED", SUBMIT, "SUBMITTED"],
      ["SUBMITTED", WAIT, "WAITING"],
      ["WAITING", APPROVE, "APPROVED"],
      ["APPROVED", PAY, "PAID"],
      ["PAID", COMPLETE, "COMPLETED"],
    ];

    for (const [from, command, to] of steps) {
      const result = apply(from, command);
      expect(result.ok, `${from} -> ${to}`).toBe(true);
      if (result.ok) expect(result.transition.status).toBe(to);
    }
  });

  it("allows the partial-payment detour APPROVED -> PARTIALLY_REIMBURSED -> PAID", () => {
    const partial = apply("APPROVED", PART);
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.transition.status).toBe("PARTIALLY_REIMBURSED");

    const paid = apply("PARTIALLY_REIMBURSED", PAY, { reimbursedAmountMinor: 5_000 });
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.transition.status).toBe("PAID");
  });
});

describe("transitions that are refused", () => {
  it("refuses to skip WAITING on the way from SUBMITTED to APPROVED", () => {
    const result = apply("SUBMITTED", APPROVE);
    expect(result).toMatchObject({ ok: false, rejection: { code: "ILLEGAL_TRANSITION" } });
  });

  it("refuses to pay a claim that was never approved", () => {
    expect(apply("SUBMITTED", PAY)).toMatchObject({ ok: false, rejection: { code: "ILLEGAL_TRANSITION" } });
    expect(apply("PLANNED", PAY)).toMatchObject({ ok: false, rejection: { code: "ILLEGAL_TRANSITION" } });
  });

  it("makes REJECTED, COMPLETED and CANCELLED terminal", () => {
    for (const terminal of ["REJECTED", "COMPLETED", "CANCELLED"] as const) {
      for (const command of [SUBMIT, WAIT, APPROVE, PAY, REJECT, COMPLETE, CANCEL]) {
        expect(apply(terminal, command), `${terminal} + ${command.type}`).toMatchObject({ ok: false });
      }
    }
  });

  // A rejected claim is not reopened; an appeal is a new claim, so the
  // original keeps saying what actually happened (ADR-015, and the same
  // reasoning as ADR-007's refusal to reopen a case).
  it("does not let a refused claim be resubmitted", () => {
    expect(apply("REJECTED", SUBMIT)).toMatchObject({ ok: false, rejection: { code: "ILLEGAL_TRANSITION" } });
  });

  // "Any open state -> CANCELLED" deliberately excludes PAID: the money
  // has arrived, so cancelling would record something untrue.
  it("cancels from any open state but not from PAID", () => {
    for (const open of ["PLANNED", "SUBMITTED", "WAITING", "APPROVED", "PARTIALLY_REIMBURSED"] as const) {
      expect(apply(open, CANCEL), open).toMatchObject({ ok: true });
    }
    expect(apply("PAID", CANCEL)).toMatchObject({ ok: false, rejection: { code: "ILLEGAL_TRANSITION" } });
  });
});

describe("the WAITING -> REJECTED edge added in ADR-015", () => {
  it("lets a claim be refused while waiting on the counterparty", () => {
    const result = apply("WAITING", REJECT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.status).toBe("REJECTED");
      expect(result.transition.patch.rejectionReason).toBe("Not covered by the policy");
    }
  });

  it("still allows the documented refusal straight from SUBMITTED", () => {
    expect(apply("SUBMITTED", REJECT)).toMatchObject({ ok: true });
  });

  it("does not allow a refusal after approval", () => {
    expect(apply("APPROVED", REJECT)).toMatchObject({ ok: false, rejection: { code: "ILLEGAL_TRANSITION" } });
  });
});

describe("data the domain insists on", () => {
  it("will not submit a claim to nobody", () => {
    expect(apply("PLANNED", { type: "SUBMIT", counterparty: "   " })).toMatchObject({
      ok: false,
      rejection: { code: "COUNTERPARTY_REQUIRED" },
    });
  });

  // The claimed amount is the sum of the attached expenses, so a zero
  // claim is one with nothing attached — chasable but never settleable.
  it("will not submit a claim with nothing attached to it", () => {
    expect(apply("PLANNED", SUBMIT, { claimedAmountMinor: 0 })).toMatchObject({
      ok: false,
      rejection: { code: "NOTHING_TO_CLAIM" },
    });
  });

  it("will not wait open-endedly without a stated reason", () => {
    expect(apply("SUBMITTED", { type: "WAIT", followUpAt: null })).toMatchObject({
      ok: false,
      rejection: { code: "FOLLOW_UP_REQUIRED" },
    });
  });

  it("accepts an open-ended wait when the reason is explicit", () => {
    const result = apply("SUBMITTED", {
      type: "WAIT",
      followUpAt: null,
      noFollowUpReason: "They said they will write when the assessor has been",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.patch.followUpAt).toBeNull();
      expect(result.transition.patch.waitingNoFollowUpReason).toContain("assessor");
    }
  });

  it("clears the follow-up notification mark so a moved date re-arms the reminder", () => {
    const result = apply("SUBMITTED", WAIT, { followUpNotifiedAt: new Date("2026-03-01T09:00:00Z") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transition.patch.followUpNotifiedAt).toBeNull();
  });

  it("will not refuse a claim without saying why", () => {
    expect(apply("WAITING", { type: "REJECT", reason: " " })).toMatchObject({
      ok: false,
      rejection: { code: "REJECTION_REASON_REQUIRED" },
    });
  });

  it("rejects non-positive and non-integer payments", () => {
    for (const amount of [0, -1, 12.5, Number.NaN]) {
      expect(
        apply("APPROVED", { type: "RECORD_FULL_PAYMENT", reimbursedAmountMinor: amount }),
        String(amount)
      ).toMatchObject({ ok: false, rejection: { code: "AMOUNT_INVALID" } });
    }
  });

  // A "partial" payment covering the whole claim would leave the record in
  // a state whose name contradicts its numbers.
  it("refuses a partial payment that covers the whole claim", () => {
    expect(apply("APPROVED", { type: "RECORD_PART_PAYMENT", reimbursedAmountMinor: 12_000 })).toMatchObject({
      ok: false,
      rejection: { code: "AMOUNT_INVALID" },
    });
  });

  // Insurers routinely pay less than was claimed. PAID means "no more is
  // coming", not "we got everything".
  it("allows a final payment smaller than the claim", () => {
    const result = apply("APPROVED", { type: "RECORD_FULL_PAYMENT", reimbursedAmountMinor: 8_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.patch.reimbursedAmountMinor).toBe(8_000);
      expect(result.transition.patch.paidAt).toEqual(NOW);
    }
  });
});

describe("waiting context is cleared on every exit", () => {
  const waiting = {
    waitingSince: new Date("2026-02-01T09:00:00Z"),
    followUpAt: new Date("2026-02-15T09:00:00Z"),
    waitingNoFollowUpReason: null,
  };

  it.each([
    ["APPROVE", "WAITING" as const, APPROVE],
    ["REJECT", "WAITING" as const, REJECT],
    ["CANCEL", "WAITING" as const, CANCEL],
  ])("clears it on %s", (_label, from, command) => {
    const result = apply(from, command, waiting);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transition.patch.waitingSince).toBeNull();
      expect(result.transition.patch.followUpAt).toBeNull();
    }
  });

  it("keeps the original waiting-since when a wait is merely re-dated", () => {
    const result = apply("SUBMITTED", WAIT, { waitingSince: waiting.waitingSince });
    expect(result.ok).toBe(true);
    // Re-dating a follow-up must not reset how long the household has
    // actually been waiting — that age is what WAITING_TOO_LONG measures.
    if (result.ok) expect(result.transition.patch.waitingSince).toEqual(waiting.waitingSince);
  });
});

describe("derived helpers", () => {
  it("treats everything up to payment as open", () => {
    const open: ReimbursementStatus[] = ["PLANNED", "SUBMITTED", "WAITING", "APPROVED", "PARTIALLY_REIMBURSED"];
    const closed: ReimbursementStatus[] = ["PAID", "REJECTED", "COMPLETED", "CANCELLED"];
    expect(open.every(isReimbursementOpen)).toBe(true);
    expect(closed.some(isReimbursementOpen)).toBe(false);
  });

  it("never reports a negative outstanding amount", () => {
    expect(outstandingMinor({ claimedAmountMinor: 100, reimbursedAmountMinor: 40 })).toBe(60);
    expect(outstandingMinor({ claimedAmountMinor: 100, reimbursedAmountMinor: 140 })).toBe(0);
  });
});

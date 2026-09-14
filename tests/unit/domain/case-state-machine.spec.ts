import { describe, expect, it } from "vitest";
import { applyCaseCommand, isCaseOpen, type Case, type CaseCommand, type CaseStatus } from "../../../domain/cases/case";

const NOW = new Date("2026-09-14T10:00:00Z");
const FOLLOW_UP = new Date("2026-09-28T10:00:00Z");

function kase(overrides: Partial<Case> = {}): Case {
  return {
    id: "c1",
    householdId: "h1",
    title: "Kindergarten place for Lukas",
    description: null,
    status: "DRAFT",
    priority: "NORMAL",
    ownerPersonId: null,
    nextAction: null,
    waitingFor: null,
    waitingSince: null,
    followUpAt: null,
    waitingNoFollowUpReason: null,
    externalReference: null,
    blockedReason: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    archivedAt: null,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof applyCaseCommand>) {
  if (!result.ok) throw new Error(`expected transition to be allowed, got ${result.rejection.code}`);
  return result.transition;
}

describe("case state machine: documented transitions (ADR-007)", () => {
  const allowed: [CaseStatus, CaseCommand, CaseStatus][] = [
    ["DRAFT", { type: "ACTIVATE" }, "ACTIVE"],
    ["DRAFT", { type: "CANCEL" }, "CANCELLED"],
    ["ACTIVE", { type: "WAIT", waitingFor: "the Amt", followUpAt: FOLLOW_UP }, "WAITING"],
    ["ACTIVE", { type: "BLOCK", reason: "missing birth certificate" }, "BLOCKED"],
    ["ACTIVE", { type: "COMPLETE" }, "COMPLETED"],
    ["ACTIVE", { type: "CANCEL" }, "CANCELLED"],
    ["WAITING", { type: "RESUME" }, "ACTIVE"],
    ["WAITING", { type: "CANCEL" }, "CANCELLED"],
    ["BLOCKED", { type: "RESUME" }, "ACTIVE"],
    ["BLOCKED", { type: "CANCEL" }, "CANCELLED"],
    ["COMPLETED", { type: "ARCHIVE" }, "ARCHIVED"],
  ];

  it.each(allowed)("allows %s -> %s", (from, command, to) => {
    expect(expectOk(applyCaseCommand(kase({ status: from }), command, NOW)).status).toBe(to);
  });

  const rejected: [CaseStatus, CaseCommand][] = [
    ["DRAFT", { type: "COMPLETE" }],
    ["DRAFT", { type: "WAIT", waitingFor: "x", followUpAt: FOLLOW_UP }],
    ["WAITING", { type: "COMPLETE" }],
    ["BLOCKED", { type: "COMPLETE" }],
    ["COMPLETED", { type: "ACTIVATE" }],
    ["ARCHIVED", { type: "ACTIVATE" }],
    ["CANCELLED", { type: "ACTIVATE" }],
    ["ACTIVE", { type: "ARCHIVE" }],
  ];

  it.each(rejected)("rejects %s with %o", (from, command) => {
    const result = applyCaseCommand(kase({ status: from }), command, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("ILLEGAL_TRANSITION");
  });

  it("treats CANCELLED and ARCHIVED as terminal", () => {
    for (const status of ["CANCELLED", "ARCHIVED"] as const) {
      for (const command of [
        { type: "ACTIVATE" },
        { type: "COMPLETE" },
        { type: "CANCEL" },
        { type: "ARCHIVE" },
      ] satisfies CaseCommand[]) {
        expect(applyCaseCommand(kase({ status }), command, NOW).ok).toBe(false);
      }
    }
  });

  it("does not allow reopening a completed case, unlike a task", () => {
    // Tasks get a reopen edge because state-machines.md mentions
    // reopening one; it says nothing of the sort about cases.
    expect(applyCaseCommand(kase({ status: "COMPLETED" }), { type: "ACTIVATE" }, NOW).ok).toBe(false);
  });

  it("does allow cancelling from WAITING, unlike a task", () => {
    // The two machines are genuinely different: ADR-007 lists
    // "DRAFT/ACTIVE/WAITING/BLOCKED -> CANCELLED" for cases.
    expect(applyCaseCommand(kase({ status: "WAITING" }), { type: "CANCEL" }, NOW).ok).toBe(true);
  });
});

describe("case state machine: invariants", () => {
  it("refuses WAITING without either a follow-up date or a stated reason", () => {
    const result = applyCaseCommand(kase({ status: "ACTIVE" }), { type: "WAIT", waitingFor: "the Amt", followUpAt: null }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("FOLLOW_UP_REQUIRED");
  });

  it("accepts WAITING with an explicit no-follow-up reason instead of a date", () => {
    const transition = expectOk(
      applyCaseCommand(
        kase({ status: "ACTIVE" }),
        { type: "WAIT", waitingFor: "the Amt", followUpAt: null, noFollowUpReason: "they will write to us" },
        NOW
      )
    );
    expect(transition.patch).toMatchObject({
      waitingFor: "the Amt",
      waitingSince: NOW,
      followUpAt: null,
      waitingNoFollowUpReason: "they will write to us",
    });
  });

  it("treats a blank no-follow-up reason as no reason at all", () => {
    const result = applyCaseCommand(
      kase({ status: "ACTIVE" }),
      { type: "WAIT", waitingFor: "the Amt", followUpAt: null, noFollowUpReason: "   " },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("prefers the follow-up date over a reason when both are given", () => {
    const transition = expectOk(
      applyCaseCommand(
        kase({ status: "ACTIVE" }),
        { type: "WAIT", waitingFor: "the Amt", followUpAt: FOLLOW_UP, noFollowUpReason: "ignored" },
        NOW
      )
    );
    expect(transition.patch.followUpAt).toEqual(FOLLOW_UP);
    expect(transition.patch.waitingNoFollowUpReason).toBeNull();
  });

  it("keeps an external reference so the wait can be chased", () => {
    const transition = expectOk(
      applyCaseCommand(
        kase({ status: "ACTIVE" }),
        { type: "WAIT", waitingFor: "the Amt", followUpAt: FOLLOW_UP, externalReference: "AZ 12/345" },
        NOW
      )
    );
    expect(transition.patch.externalReference).toBe("AZ 12/345");
  });

  it("refuses BLOCKED without a blocking reason", () => {
    const result = applyCaseCommand(kase({ status: "ACTIVE" }), { type: "BLOCK", reason: "  " }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("BLOCKING_REASON_REQUIRED");
  });

  it("clears stall context when a case is picked back up", () => {
    const waiting = kase({
      status: "WAITING",
      waitingFor: "the Amt",
      waitingSince: NOW,
      followUpAt: FOLLOW_UP,
      waitingNoFollowUpReason: "x",
    });
    expect(expectOk(applyCaseCommand(waiting, { type: "RESUME" }, NOW)).patch).toMatchObject({
      waitingFor: null,
      waitingSince: null,
      followUpAt: null,
      waitingNoFollowUpReason: null,
      blockedReason: null,
    });
  });

  it("clears the blocking reason when unblocked", () => {
    const blocked = kase({ status: "BLOCKED", blockedReason: "missing certificate" });
    expect(expectOk(applyCaseCommand(blocked, { type: "RESUME" }, NOW)).patch.blockedReason).toBeNull();
  });

  it("stamps timestamps on the terminal transitions", () => {
    expect(expectOk(applyCaseCommand(kase({ status: "ACTIVE" }), { type: "COMPLETE" }, NOW)).patch.completedAt).toEqual(NOW);
    expect(expectOk(applyCaseCommand(kase({ status: "ACTIVE" }), { type: "CANCEL" }, NOW)).patch.cancelledAt).toEqual(NOW);
    expect(expectOk(applyCaseCommand(kase({ status: "COMPLETED" }), { type: "ARCHIVE" }, NOW)).patch.archivedAt).toEqual(NOW);
  });

  it("produces a timeline line for every transition", () => {
    const transitions: [CaseStatus, CaseCommand][] = [
      ["DRAFT", { type: "ACTIVATE" }],
      ["ACTIVE", { type: "WAIT", waitingFor: "the Amt", followUpAt: FOLLOW_UP }],
      ["ACTIVE", { type: "BLOCK", reason: "missing certificate" }],
      ["ACTIVE", { type: "COMPLETE" }],
      ["ACTIVE", { type: "CANCEL", reason: "handled elsewhere" }],
    ];
    for (const [from, command] of transitions) {
      const transition = expectOk(applyCaseCommand(kase({ status: from }), command, NOW));
      expect(transition.timelineSummary.length).toBeGreaterThan(0);
      expect(transition.auditAction.startsWith("case.")).toBe(true);
    }
  });
});

describe("isCaseOpen", () => {
  it("counts DRAFT, ACTIVE, WAITING and BLOCKED as open", () => {
    expect((["DRAFT", "ACTIVE", "WAITING", "BLOCKED"] as CaseStatus[]).every(isCaseOpen)).toBe(true);
    expect((["COMPLETED", "CANCELLED", "ARCHIVED"] as CaseStatus[]).some(isCaseOpen)).toBe(false);
  });
});

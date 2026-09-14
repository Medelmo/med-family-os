import { describe, expect, it } from "vitest";
import { applyTaskCommand, isOpen, type Task, type TaskCommand, type TaskStatus } from "../../../domain/tasks/task";

const NOW = new Date("2026-09-14T10:00:00Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    householdId: "h1",
    title: "Call the dentist",
    description: null,
    status: "INBOX",
    priority: "NORMAL",
    ownerPersonId: null,
    dueOn: null,
    nextAction: null,
    waitingFor: null,
    waitingSince: null,
    followUpAt: null,
    waitingIndefinite: false,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function expectOk(result: ReturnType<typeof applyTaskCommand>) {
  if (!result.ok) throw new Error(`expected transition to be allowed, got ${result.rejection.code}`);
  return result.transition;
}

describe("task state machine: documented transitions", () => {
  const allowed: [TaskStatus, TaskCommand, TaskStatus][] = [
    ["INBOX", { type: "PLAN" }, "PLANNED"],
    ["INBOX", { type: "CANCEL" }, "CANCELLED"],
    ["PLANNED", { type: "START", ownerPersonId: "p1" }, "IN_PROGRESS"],
    ["PLANNED", { type: "WAIT", waitingFor: "the clinic", followUpAt: NOW }, "WAITING"],
    ["PLANNED", { type: "CANCEL" }, "CANCELLED"],
    ["IN_PROGRESS", { type: "COMPLETE" }, "COMPLETED"],
    ["IN_PROGRESS", { type: "WAIT", waitingFor: "the clinic", followUpAt: NOW }, "WAITING"],
    ["IN_PROGRESS", { type: "CANCEL" }, "CANCELLED"],
    ["WAITING", { type: "RESUME", ownerPersonId: "p1" }, "IN_PROGRESS"],
    ["COMPLETED", { type: "REOPEN" }, "PLANNED"],
  ];

  it.each(allowed)("allows %s -> %s", (from, command, to) => {
    const result = applyTaskCommand(task({ status: from, ownerPersonId: "p1" }), command, NOW);
    expect(expectOk(result).status).toBe(to);
  });

  const rejected: [TaskStatus, TaskCommand][] = [
    ["INBOX", { type: "COMPLETE" }],
    ["INBOX", { type: "START", ownerPersonId: "p1" }],
    ["PLANNED", { type: "COMPLETE" }],
    ["WAITING", { type: "COMPLETE" }],
    ["WAITING", { type: "CANCEL" }],
    ["COMPLETED", { type: "COMPLETE" }],
    ["CANCELLED", { type: "PLAN" }],
    ["CANCELLED", { type: "REOPEN" }],
  ];

  it.each(rejected)("rejects %s with %o", (from, command) => {
    const result = applyTaskCommand(task({ status: from, ownerPersonId: "p1" }), command, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("ILLEGAL_TRANSITION");
  });

  it("treats CANCELLED as terminal", () => {
    const commands: TaskCommand[] = [
      { type: "PLAN" },
      { type: "START", ownerPersonId: "p1" },
      { type: "COMPLETE" },
      { type: "REOPEN" },
      { type: "WAIT", waitingFor: "x", followUpAt: NOW },
    ];
    for (const command of commands) {
      expect(applyTaskCommand(task({ status: "CANCELLED" }), command, NOW).ok).toBe(false);
    }
  });
});

describe("task state machine: invariants from docs/domain/state-machines.md", () => {
  it("refuses IN_PROGRESS without an owner", () => {
    const result = applyTaskCommand(task({ status: "WAITING", ownerPersonId: null }), { type: "RESUME" }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe("OWNER_REQUIRED");
  });

  it("refuses WAITING without a follow-up date unless explicitly indefinite", () => {
    const withoutFollowUp = applyTaskCommand(
      task({ status: "PLANNED" }),
      { type: "WAIT", waitingFor: "the clinic", followUpAt: null },
      NOW
    );
    expect(withoutFollowUp.ok).toBe(false);
    if (!withoutFollowUp.ok) expect(withoutFollowUp.rejection.code).toBe("FOLLOW_UP_REQUIRED");

    const indefinite = applyTaskCommand(
      task({ status: "PLANNED" }),
      { type: "WAIT", waitingFor: "the clinic", followUpAt: null, indefinite: true },
      NOW
    );
    expect(indefinite.ok).toBe(true);
  });

  it("records waitingSince and the follow-up date when waiting starts", () => {
    const followUpAt = new Date("2026-09-21T10:00:00Z");
    const transition = expectOk(
      applyTaskCommand(task({ status: "PLANNED" }), { type: "WAIT", waitingFor: "the clinic", followUpAt }, NOW)
    );
    expect(transition.patch).toMatchObject({
      waitingFor: "the clinic",
      waitingSince: NOW,
      followUpAt,
      waitingIndefinite: false,
    });
  });

  it("stamps a completion timestamp when completing", () => {
    const transition = expectOk(applyTaskCommand(task({ status: "IN_PROGRESS", ownerPersonId: "p1" }), { type: "COMPLETE" }, NOW));
    expect(transition.patch.completedAt).toEqual(NOW);
  });

  it("clears the waiting context when leaving WAITING, so stale follow-ups cannot feed attention", () => {
    const waiting = task({
      status: "WAITING",
      ownerPersonId: "p1",
      waitingFor: "the clinic",
      waitingSince: NOW,
      followUpAt: NOW,
      waitingIndefinite: true,
    });
    const transition = expectOk(applyTaskCommand(waiting, { type: "RESUME" }, NOW));
    expect(transition.patch).toMatchObject({
      waitingFor: null,
      waitingSince: null,
      followUpAt: null,
      waitingIndefinite: false,
    });
  });

  it("clears the completion timestamp on reopen and marks it audit-worthy", () => {
    const completed = task({ status: "COMPLETED", ownerPersonId: "p1", completedAt: NOW });
    const transition = expectOk(applyTaskCommand(completed, { type: "REOPEN" }, NOW));
    expect(transition.patch.completedAt).toBeNull();
    expect(transition.auditAction).toBe("task.reopened");
  });

  it("names a distinct audit action per transition", () => {
    expect(expectOk(applyTaskCommand(task(), { type: "PLAN" }, NOW)).auditAction).toBe("task.planned");
    expect(expectOk(applyTaskCommand(task({ status: "PLANNED" }), { type: "START", ownerPersonId: "p1" }, NOW)).auditAction).toBe(
      "task.started"
    );
    expect(expectOk(applyTaskCommand(task({ status: "INBOX" }), { type: "CANCEL", reason: "duplicate" }, NOW)).auditAction).toBe(
      "task.cancelled"
    );
  });

  it("keeps the cancellation reason", () => {
    const transition = expectOk(applyTaskCommand(task(), { type: "CANCEL", reason: "handled by phone" }, NOW));
    expect(transition.patch).toMatchObject({ cancelledAt: NOW, cancelReason: "handled by phone" });
  });
});

describe("isOpen", () => {
  it("counts everything except COMPLETED and CANCELLED as open", () => {
    expect(["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"].every((s) => isOpen(s as TaskStatus))).toBe(true);
    expect(isOpen("COMPLETED")).toBe(false);
    expect(isOpen("CANCELLED")).toBe(false);
  });
});

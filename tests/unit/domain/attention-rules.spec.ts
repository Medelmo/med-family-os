import { describe, expect, it } from "vitest";
import {
  DEFAULT_ATTENTION_RULES,
  evaluateAttention,
  projectAttention,
  toIsoDate,
  type AttentionCandidate,
} from "../../../domain/attention/rules";

const TODAY = "2026-09-14";
const NOW = new Date("2026-09-14T10:00:00Z");

function candidate(overrides: Partial<AttentionCandidate> = {}): AttentionCandidate {
  return {
    id: "t1",
    kind: "task",
    title: "Call the dentist",
    status: "PLANNED",
    priority: "NORMAL",
    dueOn: null,
    followUpAt: null,
    waitingSince: null,
    waitingIndefinite: false,
    nextAction: "Ring the clinic",
    ...overrides,
  };
}

function codes(c: AttentionCandidate) {
  return evaluateAttention(c, TODAY, NOW).map((r) => r.code);
}

describe("attention rules: due dates", () => {
  it("flags a past due date as overdue, with the number of days", () => {
    const reasons = evaluateAttention(candidate({ dueOn: "2026-09-11" }), TODAY, NOW);
    expect(reasons).toContainEqual({ code: "OVERDUE", context: { daysOverdue: 3 } });
  });

  it("treats a task due today as due soon, not overdue", () => {
    expect(codes(candidate({ dueOn: TODAY }))).toContain("DUE_SOON");
    expect(codes(candidate({ dueOn: TODAY }))).not.toContain("OVERDUE");
  });

  it("flags a due date inside the configured window and ignores one beyond it", () => {
    const withinWindow = toIsoDateAfter(DEFAULT_ATTENTION_RULES.dueSoonWindowDays);
    const beyondWindow = toIsoDateAfter(DEFAULT_ATTENTION_RULES.dueSoonWindowDays + 1);
    expect(codes(candidate({ dueOn: withinWindow }))).toContain("DUE_SOON");
    expect(codes(candidate({ dueOn: beyondWindow }))).not.toContain("DUE_SOON");
  });

  it("respects a caller-supplied window instead of hard-coding one", () => {
    const inTenDays = toIsoDateAfter(10);
    const reasons = evaluateAttention(candidate({ dueOn: inTenDays }), TODAY, NOW, {
      ...DEFAULT_ATTENTION_RULES,
      dueSoonWindowDays: 14,
    });
    expect(reasons.map((r) => r.code)).toContain("DUE_SOON");
  });
});

describe("attention rules: waiting and follow-up", () => {
  it("surfaces a waiting task once its follow-up date has arrived", () => {
    const due = candidate({ status: "WAITING", followUpAt: new Date("2026-09-14T09:00:00Z") });
    expect(codes(due)).toContain("FOLLOW_UP_DUE");

    const notYet = candidate({ status: "WAITING", followUpAt: new Date("2026-09-20T09:00:00Z") });
    expect(codes(notYet)).not.toContain("FOLLOW_UP_DUE");
  });

  it("surfaces a task that has been waiting longer than the stale threshold", () => {
    const stale = candidate({ status: "WAITING", waitingSince: new Date("2026-08-20T10:00:00Z") });
    expect(codes(stale)).toContain("WAITING_TOO_LONG");

    const recent = candidate({ status: "WAITING", waitingSince: new Date("2026-09-12T10:00:00Z") });
    expect(codes(recent)).not.toContain("WAITING_TOO_LONG");
  });

  it("keeps an indefinite wait visible so the waiting list cannot become a graveyard", () => {
    const indefinite = candidate({ status: "WAITING", waitingIndefinite: true, followUpAt: null });
    expect(codes(indefinite)).toContain("WAITING_INDEFINITELY");
  });

  it("does not apply waiting rules to tasks that are not waiting", () => {
    const planned = candidate({ status: "PLANNED", waitingSince: new Date("2026-01-01T10:00:00Z"), waitingIndefinite: true });
    expect(codes(planned)).not.toContain("WAITING_TOO_LONG");
    expect(codes(planned)).not.toContain("WAITING_INDEFINITELY");
  });
});

describe("attention rules: missing next action", () => {
  it("flags actionable tasks with no next action", () => {
    expect(codes(candidate({ status: "PLANNED", nextAction: null }))).toContain("MISSING_NEXT_ACTION");
    expect(codes(candidate({ status: "IN_PROGRESS", nextAction: null }))).toContain("MISSING_NEXT_ACTION");
  });

  it("does not flag untriaged or waiting tasks for a missing next action", () => {
    expect(codes(candidate({ status: "INBOX", nextAction: null }))).not.toContain("MISSING_NEXT_ACTION");
    expect(codes(candidate({ status: "WAITING", nextAction: null, waitingIndefinite: true }))).not.toContain(
      "MISSING_NEXT_ACTION"
    );
  });
});

describe("attention projection", () => {
  it("returns nothing when nothing needs attention", () => {
    const calm = candidate({ dueOn: toIsoDateAfter(30), priority: "NORMAL", nextAction: "Ring the clinic" });
    expect(projectAttention([calm], TODAY, NOW)).toEqual([]);
  });

  it("ranks overdue above due-soon above a bare high priority", () => {
    const items = projectAttention(
      [
        candidate({ id: "soon", title: "Due soon", dueOn: TODAY }),
        candidate({ id: "priority", title: "Just important", priority: "HIGH" }),
        candidate({ id: "overdue", title: "Overdue", dueOn: "2026-09-01" }),
      ],
      TODAY,
      NOW
    );
    expect(items.map((i) => i.id)).toEqual(["overdue", "soon", "priority"]);
  });

  it("breaks ties deterministically by due date then title", () => {
    const first = projectAttention(
      [
        candidate({ id: "b", title: "Beta", dueOn: "2026-09-10" }),
        candidate({ id: "a", title: "Alpha", dueOn: "2026-09-10" }),
      ],
      TODAY,
      NOW
    );
    const second = projectAttention(
      [
        candidate({ id: "a", title: "Alpha", dueOn: "2026-09-10" }),
        candidate({ id: "b", title: "Beta", dueOn: "2026-09-10" }),
      ],
      TODAY,
      NOW
    );
    expect(first.map((i) => i.id)).toEqual(["a", "b"]);
    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));
  });

  it("explains every surfaced item rather than only scoring it", () => {
    const [item] = projectAttention([candidate({ dueOn: "2026-09-01", priority: "CRITICAL" })], TODAY, NOW);
    expect(item.reasons.length).toBeGreaterThan(0);
    expect(item.reasons.map((r) => r.code)).toContain("OVERDUE");
    expect(item.score).toBeGreaterThan(0);
  });
});

describe("toIsoDate", () => {
  it("reads a date-only value in UTC so it cannot drift a day", () => {
    expect(toIsoDate(new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
  });
});

function toIsoDateAfter(days: number): string {
  const base = Date.parse(`${TODAY}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

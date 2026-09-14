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
    priority: "NORMAL",
    dueOn: null,
    waiting: null,
    blocked: null,
    actionable: true,
    nextAction: "Ring the clinic",
    ...overrides,
  };
}

function codes(c: AttentionCandidate) {
  return evaluateAttention(c, TODAY, NOW).map((r) => r.code);
}

function isoDateAfter(days: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("attention rules: due dates", () => {
  it("flags a past due date as overdue, with the number of days", () => {
    expect(evaluateAttention(candidate({ dueOn: "2026-09-11" }), TODAY, NOW)).toContainEqual({
      code: "OVERDUE",
      context: { daysOverdue: 3 },
    });
  });

  it("treats an item due today as due soon, not overdue", () => {
    expect(codes(candidate({ dueOn: TODAY }))).toContain("DUE_SOON");
    expect(codes(candidate({ dueOn: TODAY }))).not.toContain("OVERDUE");
  });

  it("flags a due date inside the configured window and ignores one beyond it", () => {
    expect(codes(candidate({ dueOn: isoDateAfter(DEFAULT_ATTENTION_RULES.dueSoonWindowDays) }))).toContain("DUE_SOON");
    expect(codes(candidate({ dueOn: isoDateAfter(DEFAULT_ATTENTION_RULES.dueSoonWindowDays + 1) }))).not.toContain("DUE_SOON");
  });

  it("respects a caller-supplied window instead of hard-coding one", () => {
    const reasons = evaluateAttention(candidate({ dueOn: isoDateAfter(10) }), TODAY, NOW, {
      ...DEFAULT_ATTENTION_RULES,
      dueSoonWindowDays: 14,
    });
    expect(reasons.map((r) => r.code)).toContain("DUE_SOON");
  });
});

describe("attention rules: waiting", () => {
  it("surfaces something waiting once its follow-up date has arrived", () => {
    const due = candidate({ waiting: { since: NOW, followUpAt: new Date("2026-09-14T09:00:00Z"), indefinite: false } });
    expect(codes(due)).toContain("FOLLOW_UP_DUE");

    const notYet = candidate({ waiting: { since: NOW, followUpAt: new Date("2026-09-20T09:00:00Z"), indefinite: false } });
    expect(codes(notYet)).not.toContain("FOLLOW_UP_DUE");
  });

  it("surfaces something that has been waiting longer than the stale threshold", () => {
    const stale = candidate({ waiting: { since: new Date("2026-08-20T10:00:00Z"), followUpAt: null, indefinite: false } });
    expect(codes(stale)).toContain("WAITING_TOO_LONG");

    const recent = candidate({ waiting: { since: new Date("2026-09-12T10:00:00Z"), followUpAt: null, indefinite: false } });
    expect(codes(recent)).not.toContain("WAITING_TOO_LONG");
  });

  it("keeps an indefinite wait visible so the waiting list cannot become a graveyard", () => {
    expect(codes(candidate({ waiting: { since: NOW, followUpAt: null, indefinite: true } }))).toContain(
      "WAITING_INDEFINITELY"
    );
  });

  it("applies no waiting rules to something that is not waiting", () => {
    const notWaiting = candidate({ waiting: null });
    expect(codes(notWaiting)).not.toContain("WAITING_TOO_LONG");
    expect(codes(notWaiting)).not.toContain("WAITING_INDEFINITELY");
    expect(codes(notWaiting)).not.toContain("FOLLOW_UP_DUE");
  });
});

describe("attention rules: blocked", () => {
  it("flags a blocked item and carries the reason for the explanation", () => {
    const reasons = evaluateAttention(candidate({ blocked: { reason: "missing birth certificate" } }), TODAY, NOW);
    expect(reasons).toContainEqual({ code: "BLOCKED", context: { reason: "missing birth certificate" } });
  });

  it("outranks waiting, because blocked is stalled on us rather than on someone else", () => {
    const [first] = projectAttention(
      [
        candidate({ id: "waiting", title: "Waiting", waiting: { since: NOW, followUpAt: null, indefinite: true } }),
        candidate({ id: "blocked", title: "Blocked", blocked: { reason: "need a document" } }),
      ],
      TODAY,
      NOW
    );
    expect(first.id).toBe("blocked");
  });
});

describe("attention rules: missing next action", () => {
  it("flags actionable work with no next action", () => {
    expect(codes(candidate({ actionable: true, nextAction: null }))).toContain("MISSING_NEXT_ACTION");
  });

  it("does not nag about work that is deliberately parked", () => {
    expect(codes(candidate({ actionable: false, nextAction: null }))).not.toContain("MISSING_NEXT_ACTION");
  });
});

describe("attention projection", () => {
  it("returns nothing when nothing needs attention", () => {
    expect(projectAttention([candidate({ dueOn: isoDateAfter(30) })], TODAY, NOW)).toEqual([]);
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
    const order = (ids: string[]) =>
      projectAttention(
        ids.map((id) => candidate({ id, title: id === "a" ? "Alpha" : "Beta", dueOn: "2026-09-10" })),
        TODAY,
        NOW
      ).map((i) => i.id);

    expect(order(["b", "a"])).toEqual(["a", "b"]);
    expect(order(["a", "b"])).toEqual(["a", "b"]);
  });

  it("explains every surfaced item rather than only scoring it", () => {
    const [item] = projectAttention([candidate({ dueOn: "2026-09-01", priority: "CRITICAL" })], TODAY, NOW);
    expect(item.reasons.map((r) => r.code)).toContain("OVERDUE");
    expect(item.score).toBeGreaterThan(0);
  });

  it("ranks tasks and cases against each other in one list", () => {
    const items = projectAttention(
      [
        candidate({ id: "task", kind: "task", title: "A task", priority: "HIGH" }),
        candidate({ id: "case", kind: "case", title: "A case", dueOn: "2026-09-01" }),
      ],
      TODAY,
      NOW
    );
    // One ordered list, not two — the household has one attention budget.
    expect(items.map((i) => i.kind)).toEqual(["case", "task"]);
  });
});

describe("toIsoDate", () => {
  it("reads a date-only value in UTC so it cannot drift a day", () => {
    expect(toIsoDate(new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
  });
});

/**
 * Preparation is not the same thing as overdue: nothing is late, and the
 * date has not passed — what matters is that the window to act on it is
 * closing (product-spec.md, "trip preparation incomplete").
 */
describe("attention rules: preparation before a date", () => {
  const preparing = (days: number, preparation: { outstanding: number; unverified: number }) =>
    candidate({ kind: "trip", dueOn: isoDateAfter(days), preparation, nextAction: "Book the hotel" });

  it("says nothing about preparation that is still months away", () => {
    expect(codes(preparing(60, { outstanding: 4, unverified: 2 }))).not.toContain("PREPARATION_INCOMPLETE");
    expect(codes(preparing(60, { outstanding: 4, unverified: 2 }))).not.toContain("UNVERIFIED_FACTS");
  });

  it("surfaces unfinished preparation once the window opens", () => {
    const reasons = codes(preparing(DEFAULT_ATTENTION_RULES.preparationWindowDays, { outstanding: 4, unverified: 0 }));
    expect(reasons).toContain("PREPARATION_INCOMPLETE");
  });

  it("counts what is outstanding, so the reason can be explained", () => {
    expect(evaluateAttention(preparing(10, { outstanding: 4, unverified: 0 }), TODAY, NOW)).toContainEqual({
      code: "PREPARATION_INCOMPLETE",
      context: { outstanding: 4, daysUntilDue: 10 },
    });
  });

  it("says nothing when everything is done", () => {
    expect(codes(preparing(10, { outstanding: 0, unverified: 0 }))).not.toContain("PREPARATION_INCOMPLETE");
  });

  // A bag can be packed the night before; a hotel cannot grow a lift.
  it("ranks an unanswered question above an unfinished list", () => {
    const reasons = evaluateAttention(preparing(10, { outstanding: 3, unverified: 1 }), TODAY, NOW);
    const order = reasons.map((r) => r.code);
    expect(order.indexOf("UNVERIFIED_FACTS")).toBeLessThan(order.indexOf("PREPARATION_INCOMPLETE"));

    const [unverifiedOnly] = projectAttention([preparing(10, { outstanding: 0, unverified: 1 })], TODAY, NOW);
    const [outstandingOnly] = projectAttention([preparing(10, { outstanding: 1, unverified: 0 })], TODAY, NOW);
    expect(unverifiedOnly.score).toBeGreaterThan(outstandingOnly.score);
  });

  // Once the date has passed, the item is overdue; preparing for it is no
  // longer the useful thing to say.
  it("stops talking about preparation once the date is behind us", () => {
    const reasons = codes(candidate({ kind: "trip", dueOn: isoDateAfter(-1), preparation: { outstanding: 3, unverified: 1 } }));
    expect(reasons).toContain("OVERDUE");
    expect(reasons).not.toContain("PREPARATION_INCOMPLETE");
  });

  it("ignores preparation on something with no date at all", () => {
    expect(codes(candidate({ dueOn: null, preparation: { outstanding: 9, unverified: 9 } }))).not.toContain(
      "PREPARATION_INCOMPLETE"
    );
  });
});

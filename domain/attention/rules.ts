import type { Priority } from "../shared/types";
import type { TaskStatus } from "../tasks/task";

/**
 * Deterministic, explainable attention rules.
 *
 * docs/requirements/product-spec.md is emphatic that attention is "a
 * projection, not stored truth" and that the rules "must be deterministic
 * and explainable. Never show an opaque AI score as the primary attention
 * mechanism." So: no stored attention table, no learned weights, and every
 * surfaced item carries the specific reasons that surfaced it — the score
 * only orders the list, it is never the explanation shown to the user.
 *
 * This module is pure. It takes the clock and the household's idea of
 * "today" as inputs rather than reading them, both so it is testable and
 * because CLAUDE.md §7 forbids inferring a timezone for stored domain
 * meaning — the caller resolves the household's IANA timezone into
 * `todayIso` and passes it down.
 */

export type AttentionReasonCode =
  | "OVERDUE"
  | "DUE_SOON"
  | "FOLLOW_UP_DUE"
  | "WAITING_TOO_LONG"
  | "WAITING_INDEFINITELY"
  | "MISSING_NEXT_ACTION"
  | "HIGH_PRIORITY";

export interface AttentionRuleConfig {
  /** A due date within this many days counts as "due soon". */
  dueSoonWindowDays: number;
  /** A task waiting longer than this, with no follow-up reached yet, is stale. */
  waitingStaleDays: number;
}

export const DEFAULT_ATTENTION_RULES: AttentionRuleConfig = {
  dueSoonWindowDays: 3,
  waitingStaleDays: 14,
};

/**
 * Weights order the list; they are not a quality judgement and are never
 * shown. Overdue outranks everything because a missed commitment is the
 * one failure the household cannot undo by acting sooner.
 */
const WEIGHTS: Record<AttentionReasonCode, number> = {
  OVERDUE: 100,
  FOLLOW_UP_DUE: 70,
  DUE_SOON: 50,
  WAITING_TOO_LONG: 40,
  WAITING_INDEFINITELY: 15,
  MISSING_NEXT_ACTION: 20,
  HIGH_PRIORITY: 30,
};

const PRIORITY_BONUS: Record<Priority, number> = {
  CRITICAL: 30,
  HIGH: 15,
  NORMAL: 0,
  LOW: -10,
};

export interface AttentionReason {
  code: AttentionReasonCode;
  /** Values the UI needs to render an explanation in the user's language. */
  context?: Record<string, string | number>;
}

export interface AttentionCandidate {
  id: string;
  kind: "task";
  title: string;
  status: TaskStatus;
  priority: Priority;
  /** Date-only, as "YYYY-MM-DD" — see toIsoDate. */
  dueOn: string | null;
  followUpAt: Date | null;
  waitingSince: Date | null;
  waitingIndefinite: boolean;
  nextAction: string | null;
}

export interface AttentionItem extends AttentionCandidate {
  reasons: AttentionReason[];
  score: number;
}

/**
 * Date-only rendering of an instant, read in UTC.
 *
 * Drizzle returns `date` columns as a Date at UTC midnight, so reading the
 * UTC parts is what keeps a date-only value (a due *date*, not a moment)
 * from drifting a day under a local-timezone reading.
 */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysBetweenIsoDates(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function daysSince(instant: Date, now: Date): number {
  return Math.floor((now.getTime() - instant.getTime()) / 86_400_000);
}

/**
 * @param todayIso the household's current date ("YYYY-MM-DD"), resolved in
 *   the household's timezone by the caller.
 */
export function evaluateAttention(
  candidate: AttentionCandidate,
  todayIso: string,
  now: Date,
  config: AttentionRuleConfig = DEFAULT_ATTENTION_RULES
): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  if (candidate.dueOn) {
    const daysUntilDue = daysBetweenIsoDates(todayIso, candidate.dueOn);
    if (daysUntilDue < 0) {
      reasons.push({ code: "OVERDUE", context: { daysOverdue: Math.abs(daysUntilDue) } });
    } else if (daysUntilDue <= config.dueSoonWindowDays) {
      reasons.push({ code: "DUE_SOON", context: { daysUntilDue } });
    }
  }

  if (candidate.status === "WAITING") {
    if (candidate.followUpAt && candidate.followUpAt.getTime() <= now.getTime()) {
      reasons.push({ code: "FOLLOW_UP_DUE" });
    }

    if (candidate.waitingSince) {
      const waitingDays = daysSince(candidate.waitingSince, now);
      if (waitingDays >= config.waitingStaleDays) {
        reasons.push({ code: "WAITING_TOO_LONG", context: { waitingDays } });
      }
    }

    // An indefinite wait is legitimate but must never become invisible —
    // product-spec.md: "Without these fields, a waiting list becomes a
    // graveyard." A low weight keeps it on the list without crowding out
    // items that have a real date attached.
    if (candidate.waitingIndefinite) {
      reasons.push({ code: "WAITING_INDEFINITELY" });
    }
  }

  // An actionable task nobody has written a next step for is the single
  // most common way work stalls silently.
  if ((candidate.status === "PLANNED" || candidate.status === "IN_PROGRESS") && !candidate.nextAction) {
    reasons.push({ code: "MISSING_NEXT_ACTION" });
  }

  if (candidate.priority === "HIGH" || candidate.priority === "CRITICAL") {
    reasons.push({ code: "HIGH_PRIORITY", context: { priority: candidate.priority } });
  }

  return reasons;
}

export function scoreAttention(reasons: AttentionReason[], priority: Priority): number {
  if (reasons.length === 0) return 0;
  const base = reasons.reduce((total, reason) => total + WEIGHTS[reason.code], 0);
  return base + PRIORITY_BONUS[priority];
}

/**
 * Projects candidates into the ordered attention list. Only items with at
 * least one reason appear — an empty Attention view means nothing needs
 * attention, which is a real and desirable state, not an empty-data bug.
 */
export function projectAttention(
  candidates: AttentionCandidate[],
  todayIso: string,
  now: Date,
  config: AttentionRuleConfig = DEFAULT_ATTENTION_RULES
): AttentionItem[] {
  return candidates
    .map((candidate) => {
      const reasons = evaluateAttention(candidate, todayIso, now, config);
      return { ...candidate, reasons, score: scoreAttention(reasons, candidate.priority) };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable, explainable tie-breaks: earliest due date first, then
      // title, so the same data always renders in the same order.
      if (a.dueOn !== b.dueOn) {
        if (!a.dueOn) return 1;
        if (!b.dueOn) return -1;
        return a.dueOn < b.dueOn ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });
}

import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { deadlines } from "../../../db/schema";
import { getHouseholdTimezone, getTasks, type TaskListItem } from "../tasks/getTasks";
import { getCases, type CaseListItem } from "../cases/getCases";
import { householdToday } from "../../time";
import {
  projectAttention,
  toIsoDate,
  type AttentionCandidate,
  type AttentionItem,
  type AttentionRuleConfig,
} from "../../../domain/attention/rules";
import type { Actor } from "../../policies/authorize";
import { canAccess } from "../../policies/authorize";

/**
 * The Attention projection.
 *
 * Computed on read from the same rows everything else uses — there is no
 * attention table, because product-spec.md is explicit that attention is
 * "a projection, not stored truth". Storing it would create a second copy
 * of the truth that can silently disagree with the first.
 *
 * Tasks and cases are ranked in one list rather than two: the household
 * has one attention budget, and splitting it by aggregate would leave the
 * reader to merge the lists in their head — which is the work this view
 * exists to do for them.
 */
export async function getAttention(
  actor: Actor,
  householdId: string,
  now: Date = new Date(),
  config?: AttentionRuleConfig
): Promise<{ items: AttentionItem[]; todayIso: string }> {
  const [timezone, tasks, cases] = await Promise.all([
    getHouseholdTimezone(householdId),
    getTasks(actor, householdId),
    getCases(actor, householdId),
  ]);
  const todayIso = householdToday(timezone, now);

  const items = projectAttention(
    [...tasks.map(taskToCandidate), ...cases.map(caseToCandidate)],
    todayIso,
    now,
    config
  );

  return { items, todayIso };
}

/**
 * Maps a case onto the rules' normalised shape.
 *
 * A case has no due date of its own — a date the household is committed to
 * is a Deadline, linked to the case — so `dueOn` is null and the follow-up
 * date carries the time pressure instead.
 */
function caseToCandidate(kase: CaseListItem): AttentionCandidate {
  return {
    id: kase.id,
    kind: "case",
    title: kase.title,
    priority: kase.priority,
    dueOn: null,
    waiting:
      kase.status === "WAITING"
        ? {
            since: kase.waitingSince,
            followUpAt: kase.followUpAt,
            // A case waits open-endedly only by explicit choice, recorded
            // as a reason (domain/cases/case.ts).
            indefinite: kase.followUpAt === null && kase.waitingNoFollowUpReason !== null,
          }
        : null,
    blocked: kase.status === "BLOCKED" ? { reason: kase.blockedReason } : null,
    actionable: kase.status === "ACTIVE",
    nextAction: kase.nextAction,
  };
}

/**
 * Maps a task onto the rules' normalised shape. The task's status enum
 * stops here: domain/attention/rules.ts never sees it, so adding a status
 * cannot silently change what the attention rules do.
 */
function taskToCandidate(task: TaskListItem): AttentionCandidate {
  return {
    id: task.id,
    kind: "task",
    title: task.title,
    priority: task.priority,
    dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
    waiting:
      task.status === "WAITING"
        ? { since: task.waitingSince, followUpAt: task.followUpAt, indefinite: task.waitingIndefinite }
        : null,
    // Tasks have no blocked state — that distinction exists only for cases
    // (docs/domain/state-machines.md).
    blocked: null,
    actionable: task.status === "PLANNED" || task.status === "IN_PROGRESS",
    nextAction: task.nextAction,
  };
}

export interface TodayView {
  todayIso: string;
  /** Tasks due on or before today, plus anything whose follow-up has come up. */
  dueToday: TaskListItem[];
  waiting: TaskListItem[];
  deadlines: { id: string; title: string; dueOn: Date }[];
}

/**
 * Today = what is actually on the household's plate right now.
 *
 * CLAUDE.md §4.3: "It must not become a statistics dashboard." So this
 * returns the specific records due, waiting, and committed to — not counts.
 */
export async function getToday(actor: Actor, householdId: string, now: Date = new Date()): Promise<TodayView> {
  const [timezone, allTasks] = await Promise.all([getHouseholdTimezone(householdId), getTasks(actor, householdId)]);
  const todayIso = householdToday(timezone, now);

  const dueToday = allTasks.filter((task) => {
    if (task.status === "WAITING") return false;
    if (!task.dueOn) return false;
    return toIsoDate(task.dueOn) <= todayIso;
  });

  const waiting = allTasks.filter(
    (task) => task.status === "WAITING" && (!task.followUpAt || task.followUpAt.getTime() <= now.getTime())
  );

  const deadlineRows = await db
    .select()
    .from(deadlines)
    .where(
      and(
        eq(deadlines.householdId, householdId),
        isNull(deadlines.metAt),
        isNull(deadlines.archivedAt),
        lte(deadlines.dueOn, new Date(`${todayIso}T00:00:00Z`))
      )
    )
    .orderBy(asc(deadlines.dueOn))
    .limit(100);

  const visibleDeadlines = deadlineRows
    .filter((row) =>
      canAccess(actor, "read", {
        householdId: row.householdId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
        ownerUserId: row.createdBy ?? undefined,
      })
    )
    .map((row) => ({ id: row.id, title: row.title, dueOn: row.dueOn }));

  return { todayIso, dueToday, waiting, deadlines: visibleDeadlines };
}

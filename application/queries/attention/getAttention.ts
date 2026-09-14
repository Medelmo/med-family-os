import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { deadlines } from "../../../db/schema";
import { getHouseholdTimezone, getTasks, type TaskListItem } from "../tasks/getTasks";
import { householdToday } from "../../time";
import {
  projectAttention,
  toIsoDate,
  type AttentionItem,
  type AttentionRuleConfig,
} from "../../../domain/attention/rules";
import type { Actor } from "../../policies/authorize";
import { canAccess } from "../../policies/authorize";

/**
 * The Attention projection.
 *
 * Computed on read from the same task rows everything else uses — there is
 * no attention table, because product-spec.md is explicit that attention is
 * "a projection, not stored truth". Storing it would create a second copy
 * of the truth that can silently disagree with the first.
 */
export async function getAttention(
  actor: Actor,
  householdId: string,
  now: Date = new Date(),
  config?: AttentionRuleConfig
): Promise<{ items: AttentionItem[]; todayIso: string }> {
  const [timezone, tasks] = await Promise.all([getHouseholdTimezone(householdId), getTasks(actor, householdId)]);
  const todayIso = householdToday(timezone, now);

  const items = projectAttention(
    tasks.map((task) => taskToCandidate(task)),
    todayIso,
    now,
    config
  );

  return { items, todayIso };
}

function taskToCandidate(task: TaskListItem) {
  return {
    id: task.id,
    kind: "task" as const,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
    followUpAt: task.followUpAt,
    waitingSince: task.waitingSince,
    waitingIndefinite: task.waitingIndefinite,
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

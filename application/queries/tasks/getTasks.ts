import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { households, people, taskPeople, tasks } from "../../../db/schema";
import { authorizeTaskAccess } from "../../policies/task";
import type { Actor } from "../../policies/authorize";
import { OPEN_TASK_STATUSES, type TaskStatus } from "../../../domain/tasks/task";
import type { Priority } from "../../../domain/shared/types";

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueOn: Date | null;
  nextAction: string | null;
  waitingFor: string | null;
  waitingSince: Date | null;
  followUpAt: Date | null;
  waitingIndefinite: boolean;
  ownerName: string | null;
  version: number;
}

/**
 * Household tasks the actor may actually see.
 *
 * Authorization is applied per row in the application layer rather than
 * pushed into SQL: the policy depends on visibility, sensitivity, creator
 * and person-scope together (application/policies/authorize.ts), which a
 * WHERE clause would have to duplicate — and a duplicated policy is a
 * policy that drifts. The household filter and LIMIT keep the set small
 * enough (one household's open work) that this is not the "fetch
 * everything and filter" anti-pattern CLAUDE.md §27 warns about.
 */
export async function getTasks(
  actor: Actor,
  householdId: string,
  options: { statuses?: readonly TaskStatus[]; limit?: number } = {}
): Promise<TaskListItem[]> {
  const statuses = options.statuses ?? OPEN_TASK_STATUSES;

  const rows = await db
    .select({
      task: tasks,
      ownerName: people.displayName,
    })
    .from(tasks)
    .leftJoin(people, eq(people.id, tasks.ownerPersonId))
    .where(and(eq(tasks.householdId, householdId), inArray(tasks.status, [...statuses])))
    .orderBy(asc(tasks.dueOn), asc(tasks.createdAt))
    .limit(options.limit ?? 500);

  if (rows.length === 0) return [];

  // One extra query for every task's person scope, rather than one per
  // task (N+1).
  const scopeRows = await db
    .select({ taskId: taskPeople.taskId, personId: taskPeople.personId })
    .from(taskPeople)
    .where(
      inArray(
        taskPeople.taskId,
        rows.map((r) => r.task.id)
      )
    );

  const scopeByTask = new Map<string, string[]>();
  for (const row of scopeRows) {
    const existing = scopeByTask.get(row.taskId);
    if (existing) existing.push(row.personId);
    else scopeByTask.set(row.taskId, [row.personId]);
  }

  return rows
    .filter(({ task }) =>
      authorizeTaskAccess(actor, "read", {
        householdId: task.householdId,
        visibility: task.visibility,
        sensitivity: task.sensitivity,
        createdBy: task.createdBy,
        personScopeIds: scopeByTask.get(task.id) ?? [],
      })
    )
    .map(({ task, ownerName }) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueOn: task.dueOn,
      nextAction: task.nextAction,
      waitingFor: task.waitingFor,
      waitingSince: task.waitingSince,
      followUpAt: task.followUpAt,
      waitingIndefinite: task.waitingIndefinite,
      ownerName,
      version: task.version,
    }));
}

export async function getHouseholdTimezone(householdId: string): Promise<string> {
  const [row] = await db.select({ timezone: households.timezone }).from(households).where(eq(households.id, householdId)).limit(1);
  return row?.timezone ?? "UTC";
}

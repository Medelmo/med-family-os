import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { caseEvents, casePeople, caseTasks, cases, people, tasks } from "../../../db/schema";
import { authorizeCaseAccess } from "../../policies/case";
import type { Actor } from "../../policies/authorize";
import { OPEN_CASE_STATUSES, type CaseStatus } from "../../../domain/cases/case";
import type { Priority, Sensitivity } from "../../../domain/shared/types";
import { AuthorizationError, NotFoundError } from "../../errors";

export interface CaseListItem {
  id: string;
  title: string;
  status: CaseStatus;
  priority: Priority;
  nextAction: string | null;
  waitingFor: string | null;
  waitingSince: Date | null;
  followUpAt: Date | null;
  waitingNoFollowUpReason: string | null;
  blockedReason: string | null;
  ownerName: string | null;
  version: number;
  /**
   * Carried on the projection because callers need to make decisions
   * *about* it, not only be filtered by it — the assistant's disclosure
   * gate has to know how sensitive a case is before deciding whether a
   * model may be told anything at all about it (ADR-027).
   */
  sensitivity: Sensitivity;
}

function toListItem(row: typeof cases.$inferSelect, ownerName: string | null): CaseListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    nextAction: row.nextAction,
    waitingFor: row.waitingFor,
    waitingSince: row.waitingSince,
    followUpAt: row.followUpAt,
    waitingNoFollowUpReason: row.waitingNoFollowUpReason,
    blockedReason: row.blockedReason,
    ownerName,
    version: row.version,
    sensitivity: row.sensitivity,
  };
}

/**
 * Household cases the actor may see. Same approach as getTasks: the
 * household filter and LIMIT bound the set, then the row-level policy
 * decides — rather than duplicating the policy into a WHERE clause where
 * it would drift.
 */
export async function getCases(
  actor: Actor,
  householdId: string,
  options: { statuses?: readonly CaseStatus[]; limit?: number } = {}
): Promise<CaseListItem[]> {
  const statuses = options.statuses ?? OPEN_CASE_STATUSES;

  const rows = await db
    .select({ kase: cases, ownerName: people.displayName })
    .from(cases)
    .leftJoin(people, eq(people.id, cases.ownerPersonId))
    .where(and(eq(cases.householdId, householdId), inArray(cases.status, [...statuses])))
    .orderBy(asc(cases.followUpAt), desc(cases.createdAt))
    .limit(options.limit ?? 200);

  if (rows.length === 0) return [];

  const scopeRows = await db
    .select({ caseId: casePeople.caseId, personId: casePeople.personId })
    .from(casePeople)
    .where(
      inArray(
        casePeople.caseId,
        rows.map((r) => r.kase.id)
      )
    );

  const scopeByCase = new Map<string, string[]>();
  for (const row of scopeRows) {
    const existing = scopeByCase.get(row.caseId);
    if (existing) existing.push(row.personId);
    else scopeByCase.set(row.caseId, [row.personId]);
  }

  return rows
    .filter(({ kase }) =>
      authorizeCaseAccess(actor, "read", {
        householdId: kase.householdId,
        visibility: kase.visibility,
        sensitivity: kase.sensitivity,
        createdBy: kase.createdBy,
        personScopeIds: scopeByCase.get(kase.id) ?? [],
      })
    )
    .map(({ kase, ownerName }) => toListItem(kase, ownerName));
}

export interface CaseTimelineEntry {
  id: string;
  type: string;
  summary: string;
  createdAt: Date;
}

export interface CaseDetail extends CaseListItem {
  description: string | null;
  externalReference: string | null;
  people: { id: string; displayName: string }[];
  tasks: { id: string; title: string; status: string }[];
  timeline: CaseTimelineEntry[];
}

/**
 * A case with the context needed to act on it: who it concerns, the work
 * hanging off it, and what has happened so far. Loaded in one place so a
 * detail page renders from a single authorized read rather than assembling
 * itself from several unchecked ones.
 */
export async function getCase(actor: Actor, householdId: string, caseId: string): Promise<CaseDetail> {
  const [row] = await db
    .select({ kase: cases, ownerName: people.displayName })
    .from(cases)
    .leftJoin(people, eq(people.id, cases.ownerPersonId))
    .where(and(eq(cases.id, caseId), eq(cases.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Case not found.");

  const personRows = await db
    .select({ id: people.id, displayName: people.displayName })
    .from(casePeople)
    .innerJoin(people, eq(people.id, casePeople.personId))
    .where(eq(casePeople.caseId, caseId));

  const authorized = authorizeCaseAccess(actor, "read", {
    householdId: row.kase.householdId,
    visibility: row.kase.visibility,
    sensitivity: row.kase.sensitivity,
    createdBy: row.kase.createdBy,
    personScopeIds: personRows.map((p) => p.id),
  });
  // Not found rather than forbidden would be kinder to enumeration, but
  // this is a single household of known members — a clear "you may not see
  // this" is more useful to them than a lie.
  if (!authorized) throw new AuthorizationError("Not permitted to view this case.");

  const [taskRows, timelineRows] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(caseTasks)
      .innerJoin(tasks, eq(tasks.id, caseTasks.taskId))
      .where(eq(caseTasks.caseId, caseId)),
    db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, caseId))
      .orderBy(desc(caseEvents.createdAt))
      .limit(100),
  ]);

  return {
    ...toListItem(row.kase, row.ownerName),
    description: row.kase.description,
    externalReference: row.kase.externalReference,
    people: personRows,
    tasks: taskRows,
    timeline: timelineRows.map((e) => ({ id: e.id, type: e.type, summary: e.summary, createdAt: e.createdAt })),
  };
}

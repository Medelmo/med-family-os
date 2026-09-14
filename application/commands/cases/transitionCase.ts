import { and, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { caseEvents, casePeople, cases } from "../../../db/schema";
import { applyCaseCommand, type Case, type CaseCommand } from "../../../domain/cases/case";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeCaseAccess } from "../../policies/case";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class IllegalCaseTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IllegalCaseTransitionError";
    this.code = code;
  }
}

/**
 * The only path by which a case's status changes — the same division of
 * responsibility as transitionTask: the pure domain function decides, this
 * owns the transaction, authorization, optimistic concurrency, the audit
 * record and the timeline entry.
 */
export async function transitionCase(
  actor: Actor,
  householdId: string,
  caseId: string,
  expectedVersion: number,
  command: CaseCommand,
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.householdId, householdId)))
      .limit(1);

    if (!row) throw new NotFoundError("Case not found.");

    const scopeRows = await tx.select({ personId: casePeople.personId }).from(casePeople).where(eq(casePeople.caseId, caseId));

    const authorized = authorizeCaseAccess(actor, "update", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: scopeRows.map((s) => s.personId),
    });
    if (!authorized) throw new AuthorizationError("Not permitted to change this case.");

    const result = applyCaseCommand(row as unknown as Case, command, now);
    if (!result.ok) {
      throw new IllegalCaseTransitionError(result.rejection.code, result.rejection.message);
    }

    const updated = await tx
      .update(cases)
      .set({ ...result.transition.patch, updatedAt: now, version: row.version + 1 })
      .where(and(eq(cases.id, caseId), eq(cases.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This case was changed by someone else. Reload and try again.");
    }

    // The timeline is the case's own record of what happened, written in
    // the same transaction so it can never disagree with the status.
    await tx.insert(caseEvents).values({
      caseId,
      householdId,
      type: "STATUS_CHANGED",
      summary: result.transition.timelineSummary,
      metadata: { from: row.status, to: result.transition.status },
      actorUserId: actor.userId,
    });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: result.transition.auditAction,
        resourceType: "case",
        resourceId: caseId,
        metadata: { from: row.status, to: result.transition.status },
      },
      tx
    );

    return updated[0];
  });
}

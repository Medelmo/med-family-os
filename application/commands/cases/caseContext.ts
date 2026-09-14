import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { caseEvents, casePeople, caseTasks, cases, tasks } from "../../../db/schema";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeCaseAccess } from "../../policies/case";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

/** Loads a case and checks the actor may change it. Shared by the commands below. */
async function loadWritableCase(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actor: Actor, householdId: string, caseId: string) {
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

  return row;
}

const noteSchema = z.object({
  caseId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
});

/**
 * Adds a human note to the case timeline.
 *
 * Notes take no version and cause no conflict: appending to a timeline is
 * commutative, so two people writing notes at once is not a conflict to
 * resolve — it is two notes. Optimistic concurrency belongs on the case's
 * own mutable fields, not on its append-only history.
 */
export async function addCaseNote(actor: Actor, householdId: string, input: z.infer<typeof noteSchema>) {
  const parsed = noteSchema.parse(input);

  return db.transaction(async (tx) => {
    await loadWritableCase(tx, actor, householdId, parsed.caseId);

    const [event] = await tx
      .insert(caseEvents)
      .values({
        caseId: parsed.caseId,
        householdId,
        type: "NOTE",
        summary: parsed.body,
        actorUserId: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      { householdId, actorUserId: actor.userId, action: "case.note_added", resourceType: "case", resourceId: parsed.caseId },
      tx
    );

    return event;
  });
}

const nextActionSchema = z.object({
  caseId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  nextAction: z.string().trim().max(500).nullish(),
});

/**
 * Sets the case's next action — the single field that decides whether the
 * attention engine nags about this case (docs/requirements/product-spec.md
 * treats a missing next action as a first-class attention input).
 */
export async function setCaseNextAction(actor: Actor, householdId: string, input: z.infer<typeof nextActionSchema>) {
  const parsed = nextActionSchema.parse(input);

  return db.transaction(async (tx) => {
    await loadWritableCase(tx, actor, householdId, parsed.caseId);

    const updated = await tx
      .update(cases)
      .set({ nextAction: parsed.nextAction ?? null, updatedAt: new Date(), version: parsed.expectedVersion + 1 })
      .where(and(eq(cases.id, parsed.caseId), eq(cases.version, parsed.expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This case was changed by someone else. Reload and try again.");
    }

    await tx.insert(caseEvents).values({
      caseId: parsed.caseId,
      householdId,
      type: "NEXT_ACTION_SET",
      summary: parsed.nextAction ? `Next action: ${parsed.nextAction}` : "Next action cleared",
      actorUserId: actor.userId,
    });

    return updated[0];
  });
}

const linkTaskSchema = z.object({
  caseId: z.string().uuid(),
  taskId: z.string().uuid(),
});

/**
 * Attaches an existing task to a case, so work and context stop living in
 * separate places (product-spec.md journey 3: "the next action, context,
 * owner, due date and related records").
 */
export async function linkTaskToCase(actor: Actor, householdId: string, input: z.infer<typeof linkTaskSchema>) {
  const parsed = linkTaskSchema.parse(input);

  return db.transaction(async (tx) => {
    await loadWritableCase(tx, actor, householdId, parsed.caseId);

    const [task] = await tx
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.id, parsed.taskId), eq(tasks.householdId, householdId)))
      .limit(1);
    // The householdId predicate above is what stops a task from another
    // household being linked in by id (BOLA).
    if (!task) throw new NotFoundError("Task not found.");

    await tx.insert(caseTasks).values({ caseId: parsed.caseId, taskId: parsed.taskId }).onConflictDoNothing();

    await tx.insert(caseEvents).values({
      caseId: parsed.caseId,
      householdId,
      type: "TASK_LINKED",
      summary: `Linked task: ${task.title}`,
      metadata: { taskId: task.id },
      actorUserId: actor.userId,
    });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "case.task_linked",
        resourceType: "case",
        resourceId: parsed.caseId,
        metadata: { taskId: task.id },
      },
      tx
    );
  });
}

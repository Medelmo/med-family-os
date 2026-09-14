import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { inboxItems, tasks, taskPeople } from "../../../db/schema";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeInboxTriage } from "../../policies/task";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

const triageToTaskSchema = z.object({
  inboxItemId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
  dueOn: z.coerce.date().nullish(),
  nextAction: z.string().trim().max(500).nullish(),
  ownerPersonId: z.string().uuid().nullish(),
  /** People the task is about — drives personScopeIds authorization. */
  aboutPersonIds: z.array(z.string().uuid()).default([]),
});

export type TriageInboxItemToTaskInput = z.infer<typeof triageToTaskSchema>;

/**
 * Turns a capture into a Task, in one transaction, keeping the provenance
 * link so the inbox item can still say what it became.
 *
 * The new task starts in PLANNED rather than INBOX: triage *is* the act of
 * deciding this is real work, so leaving it in the task state machine's own
 * INBOX state would mean it needs triaging twice.
 */
export async function triageInboxItemToTask(actor: Actor, householdId: string, input: TriageInboxItemToTaskInput) {
  if (!authorizeInboxTriage(actor, householdId)) {
    throw new AuthorizationError("Not permitted to triage this household's inbox.");
  }

  const parsed = triageToTaskSchema.parse(input);

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.id, parsed.inboxItemId), eq(inboxItems.householdId, householdId)))
      .limit(1);

    if (!item) throw new NotFoundError("Inbox item not found.");
    if (item.status !== "UNTRIAGED") {
      throw new ConflictError("This inbox item has already been triaged.");
    }

    const [task] = await tx
      .insert(tasks)
      .values({
        householdId,
        title: parsed.title,
        status: "PLANNED",
        priority: parsed.priority,
        dueOn: parsed.dueOn ?? null,
        nextAction: parsed.nextAction ?? null,
        ownerPersonId: parsed.ownerPersonId ?? null,
        createdBy: actor.userId,
      })
      .returning();

    if (parsed.aboutPersonIds.length > 0) {
      await tx.insert(taskPeople).values(parsed.aboutPersonIds.map((personId) => ({ taskId: task.id, personId })));
    }

    // Optimistic concurrency (CLAUDE.md §8): if someone else triaged this
    // item between the read above and here, the version no longer matches
    // and this updates nothing rather than silently double-triaging.
    const updated = await tx
      .update(inboxItems)
      .set({
        status: "TRIAGED",
        triagedIntoType: "task",
        triagedIntoId: task.id,
        triagedAt: new Date(),
        updatedAt: new Date(),
        version: item.version + 1,
      })
      .where(and(eq(inboxItems.id, item.id), eq(inboxItems.version, parsed.expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This inbox item changed while you were triaging it. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "inbox.triaged",
        resourceType: "inbox_item",
        resourceId: item.id,
        metadata: { into: "task", taskId: task.id },
      },
      tx
    );

    return task;
  });
}

const discardSchema = z.object({
  inboxItemId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).nullish(),
});

/**
 * Discard is archival, not deletion (docs/security/privacy-and-retention.md
 * prefers archive over destructive deletion): the row stays, with a reason,
 * so "what happened to that thing I captured?" always has an answer.
 */
export async function discardInboxItem(actor: Actor, householdId: string, input: z.infer<typeof discardSchema>) {
  if (!authorizeInboxTriage(actor, householdId)) {
    throw new AuthorizationError("Not permitted to triage this household's inbox.");
  }

  const parsed = discardSchema.parse(input);

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(inboxItems)
      .set({
        status: "DISCARDED",
        discardReason: parsed.reason ?? null,
        triagedAt: new Date(),
        updatedAt: new Date(),
        version: parsed.expectedVersion + 1,
      })
      .where(
        and(
          eq(inboxItems.id, parsed.inboxItemId),
          eq(inboxItems.householdId, householdId),
          eq(inboxItems.version, parsed.expectedVersion),
          eq(inboxItems.status, "UNTRIAGED")
        )
      )
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This inbox item was already handled. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "inbox.discarded",
        resourceType: "inbox_item",
        resourceId: parsed.inboxItemId,
      },
      tx
    );

    return updated[0];
  });
}

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { cases, deadlines } from "../../../db/schema";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { canAccess } from "../../policies/authorize";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, NotFoundError } from "../../errors";

/**
 * Opening a deadline.
 *
 * The aggregate has existed since Phase 2 — Today reads it, the attention
 * rules rank it, and `scanForReminders` announces it — but nothing could
 * create one. Deadlines arrived in the database through a migration and,
 * in exactly one place, a direct insert in a test. A household using the
 * application could not record a date it was committed to.
 *
 * That is a strange gap to survive this long, and the reason it did is
 * instructive: every read path had a test, the reminder scan had a test,
 * and none of them needed a *command* because they all seeded rows
 * directly. The missing piece only became visible when something tried to
 * enter a real one.
 *
 * `dueOn` is a DATE, not an instant, and that is deliberate (CLAUDE.md §7).
 * A Widerspruchsfrist falls on a day, in the household's own calendar; it
 * does not expire at a particular second in UTC, and storing it as one
 * would make it land on the wrong day for somebody reading it from another
 * timezone.
 */

const createDeadlineSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  /** ISO `YYYY-MM-DD`. A date the household is committed to, not a moment. */
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueOn must be an ISO date, YYYY-MM-DD.")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "dueOn is not a real date."),
  /** Optional link to the matter this date belongs to. */
  caseId: z.string().uuid().nullish(),
  visibility: z.enum(["PRIVATE", "HOUSEHOLD", "SHARED"]).default("HOUSEHOLD"),
  sensitivity: z.enum(["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"]).default("NORMAL"),
});

export type CreateDeadlineInput = z.input<typeof createDeadlineSchema>;

export async function createDeadline(actor: Actor, householdId: string, input: CreateDeadlineInput) {
  const parsed = createDeadlineSchema.parse(input);

  const authorized = canAccess(actor, "create", {
    householdId,
    visibility: parsed.visibility,
    sensitivity: parsed.sensitivity,
    ownerUserId: actor.userId,
  });
  if (!authorized) throw new AuthorizationError("Not permitted to record a deadline in this household.");

  /*
   * A caseId from the caller is an object id from outside, so it is
   * checked against this household before it is stored — otherwise a
   * deadline could be attached to another household's case by guessing a
   * uuid, which is the BOLA the threat model names explicitly.
   */
  if (parsed.caseId) {
    const [linked] = await db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, parsed.caseId), eq(cases.householdId, householdId)))
      .limit(1);
    // NotFoundError rather than a "wrong household" message: telling an
    // attacker that the id exists but belongs elsewhere confirms the id,
    // which is the enumeration this check exists to stop.
    if (!linked) throw new NotFoundError("No such case in this household.");
  }

  return db.transaction(async (tx) => {
    const [deadline] = await tx
      .insert(deadlines)
      .values({
        householdId,
        title: parsed.title,
        description: parsed.description ?? null,
        // Parsed at UTC midnight: the column is a DATE, so the instant is
        // discarded on write, and building it from the local timezone
        // instead would shift the day either side of midnight.
        dueOn: new Date(`${parsed.dueOn}T00:00:00Z`),
        caseId: parsed.caseId ?? null,
        visibility: parsed.visibility,
        sensitivity: parsed.sensitivity,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "deadline.created",
        resourceType: "deadline",
        resourceId: deadline.id,
      },
      tx
    );

    return deadline;
  });
}

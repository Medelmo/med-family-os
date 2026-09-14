import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { caseEvents, casePeople, cases } from "../../../db/schema";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeCaseAccess } from "../../policies/case";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

const createCaseSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
  nextAction: z.string().trim().max(500).nullish(),
  ownerPersonId: z.string().uuid().nullish(),
  aboutPersonIds: z.array(z.string().uuid()).default([]),
  /** Opens the case immediately instead of leaving it in DRAFT. */
  activate: z.boolean().default(true),
});

// z.input, not z.infer: z.infer is the *output* type, in which every
// field carrying a .default() is already required — which would force
// every caller to pass values the schema exists to supply.
export type CreateCaseInput = z.input<typeof createCaseSchema>;

/**
 * Creates a case and opens its timeline with a CREATED entry.
 *
 * Defaults to ACTIVE rather than DRAFT: DRAFT exists for a case someone is
 * still composing, but the ordinary act of naming a real-world process is
 * itself the decision to track it, and making every case need a second
 * "open it" click would just be a step people learn to click through.
 */
export async function createCase(actor: Actor, householdId: string, input: CreateCaseInput) {
  const parsed = createCaseSchema.parse(input);

  const authorized = authorizeCaseAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    createdBy: actor.userId,
    personScopeIds: parsed.aboutPersonIds,
  });
  if (!authorized) throw new AuthorizationError("Not permitted to open a case in this household.");

  return db.transaction(async (tx) => {
    const [kase] = await tx
      .insert(cases)
      .values({
        householdId,
        title: parsed.title,
        description: parsed.description ?? null,
        status: parsed.activate ? "ACTIVE" : "DRAFT",
        priority: parsed.priority,
        nextAction: parsed.nextAction ?? null,
        ownerPersonId: parsed.ownerPersonId ?? null,
        createdBy: actor.userId,
      })
      .returning();

    if (parsed.aboutPersonIds.length > 0) {
      await tx.insert(casePeople).values(parsed.aboutPersonIds.map((personId) => ({ caseId: kase.id, personId })));
    }

    await tx.insert(caseEvents).values({
      caseId: kase.id,
      householdId,
      type: "CREATED",
      summary: parsed.activate ? "Case opened" : "Case drafted",
      actorUserId: actor.userId,
    });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "case.created",
        resourceType: "case",
        resourceId: kase.id,
      },
      tx
    );

    return kase;
  });
}

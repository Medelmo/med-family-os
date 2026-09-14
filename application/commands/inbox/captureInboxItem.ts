import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { inboxItems } from "../../../db/schema";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeInboxCapture } from "../../policies/task";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

const captureSchema = z.object({
  capturedText: z.string().trim().min(1).max(2000),
});

export type CaptureInboxItemInput = z.infer<typeof captureSchema>;

/**
 * Capture step of Capture -> Triage -> Execute (product-spec.md journey 1).
 * Stores the text and nothing else: deciding what it is comes later, and
 * asking at capture time is what stops people capturing.
 */
export async function captureInboxItem(actor: Actor, householdId: string, input: CaptureInboxItemInput) {
  if (!authorizeInboxCapture(actor, householdId)) {
    throw new AuthorizationError("Not permitted to capture to this household's inbox.");
  }

  const parsed = captureSchema.parse(input);

  return db.transaction(async (tx) => {
    const [item] = await tx
      .insert(inboxItems)
      .values({ householdId, capturedText: parsed.capturedText, capturedBy: actor.userId })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "inbox.captured",
        resourceType: "inbox_item",
        resourceId: item.id,
      },
      tx
    );

    return item;
  });
}

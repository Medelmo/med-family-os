import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { notifications } from "../../../db/schema";
import type { Actor } from "../../policies/authorize";

/**
 * Marks the actor's own notifications read.
 *
 * The userId predicate is not decoration: it is what stops one household
 * member marking another's notifications read by guessing an id
 * (docs/security/threat-model.md, BOLA). There is deliberately no
 * "mark anyone's" variant.
 */
export async function markNotificationsRead(actor: Actor, notificationIds?: string[]): Promise<number> {
  const scope = and(
    eq(notifications.userId, actor.userId),
    eq(notifications.householdId, actor.householdId),
    isNull(notifications.readAt)
  );

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(notificationIds?.length ? and(scope, inArray(notifications.id, notificationIds)) : scope)
    .returning({ id: notifications.id });

  return updated.length;
}

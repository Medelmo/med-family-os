import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { notifications } from "../../../db/schema";
import type { Actor } from "../../policies/authorize";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Notifications are addressed to one account, so "may I read this" is
 * simply "is it mine" — there is no household-visibility question to ask
 * and no policy wrapper to apply. The userId filter is the authorization.
 */
export async function getNotifications(actor: Actor, limit = 50): Promise<NotificationRow[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), eq(notifications.householdId, actor.householdId)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  }));
}

export async function getUnreadNotificationCount(actor: Actor): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, actor.userId),
        eq(notifications.householdId, actor.householdId),
        isNull(notifications.readAt)
      )
    );
  return rows.length;
}

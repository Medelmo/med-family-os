import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { inboxItems } from "../../../db/schema";
import { authorizeInboxCapture } from "../../policies/task";
import { canAccess, type Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

export interface InboxItemRow {
  id: string;
  capturedText: string;
  createdAt: Date;
  version: number;
}

/**
 * Untriaged captures, oldest first — the oldest thing is the one most at
 * risk of being forgotten, so it leads.
 *
 * VIEWER is excluded entirely rather than shown a read-only inbox: an inbox
 * is a work queue, and a role that can never act on it has no use for it.
 */
export async function getInbox(actor: Actor, householdId: string, limit = 200): Promise<InboxItemRow[]> {
  if (!authorizeInboxCapture(actor, householdId)) {
    throw new AuthorizationError("Not permitted to view this household's inbox.");
  }

  const rows = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.householdId, householdId), eq(inboxItems.status, "UNTRIAGED")))
    .orderBy(asc(inboxItems.createdAt))
    .limit(limit);

  // Row-level policy still applies on top of the household filter — a
  // capture can be PRIVATE to whoever wrote it.
  return rows
    .filter((row) =>
      canAccess(actor, "read", {
        householdId: row.householdId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
        ownerUserId: row.capturedBy ?? undefined,
      })
    )
    .map((row) => ({
      id: row.id,
      capturedText: row.capturedText,
      createdAt: row.createdAt,
      version: row.version,
    }));
}

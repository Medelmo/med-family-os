import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import { assets, documentReferences, expenses, trips } from "../../db/schema";
import type { LinkableType } from "../../domain/links/recordLink";
import { canAccess, type Actor } from "../policies/authorize";

export interface LinkCandidate {
  type: LinkableType;
  id: string;
  label: string;
}

/**
 * Records this actor could link something to.
 *
 * Filtered through the policy kernel exactly as `resolveRecords` is, so
 * the picker cannot become a way to discover records — a list of things
 * you may not open would tell you they exist and what they are called,
 * which is most of what a sensitivity level protects.
 *
 * Bounded per type rather than paginated: a picker is for "the thing I
 * was just looking at", and a household that needs to search for it needs
 * search, not a longer dropdown. Recent-first for the same reason.
 */
const PER_TYPE_LIMIT = 25;

export async function getLinkCandidates(actor: Actor, householdId: string): Promise<LinkCandidate[]> {
  const [documentRows, expenseRows, tripRows, assetRows] = await Promise.all([
    db
      .select()
      .from(documentReferences)
      .where(and(eq(documentReferences.householdId, householdId), isNull(documentReferences.archivedAt)))
      .orderBy(desc(documentReferences.createdAt))
      .limit(PER_TYPE_LIMIT),
    db
      .select()
      .from(expenses)
      .where(and(eq(expenses.householdId, householdId), isNull(expenses.archivedAt)))
      .orderBy(desc(expenses.incurredOn))
      .limit(PER_TYPE_LIMIT),
    db
      .select()
      .from(trips)
      .where(eq(trips.householdId, householdId))
      .orderBy(desc(trips.startsOn))
      .limit(PER_TYPE_LIMIT),
    db
      .select()
      .from(assets)
      .where(and(eq(assets.householdId, householdId), isNull(assets.disposedOn)))
      .orderBy(desc(assets.createdAt))
      .limit(PER_TYPE_LIMIT),
  ]);

  const candidates: LinkCandidate[] = [];

  for (const row of documentRows) {
    if (!visible(actor, row)) continue;
    candidates.push({ type: "document", id: row.id, label: row.titleOverride ?? row.title });
  }
  for (const row of expenseRows) {
    if (!visible(actor, row, row.personId)) continue;
    candidates.push({ type: "expense", id: row.id, label: `${row.incurredOn} · ${row.description}` });
  }
  for (const row of tripRows) {
    if (!visible(actor, row)) continue;
    candidates.push({ type: "trip", id: row.id, label: row.title });
  }
  for (const row of assetRows) {
    if (!visible(actor, row, row.personId)) continue;
    candidates.push({ type: "asset", id: row.id, label: row.name });
  }

  return candidates;
}

interface AuthorizableRow {
  householdId: string;
  visibility: "PRIVATE" | "HOUSEHOLD" | "SHARED";
  sensitivity: "NORMAL" | "SENSITIVE" | "HIGHLY_SENSITIVE";
  createdBy: string | null;
}

function visible(actor: Actor, row: AuthorizableRow, personId?: string | null): boolean {
  return canAccess(actor, "read", {
    householdId: row.householdId,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    ownerUserId: row.createdBy ?? undefined,
    personScopeIds: personId ? [personId] : undefined,
  });
}

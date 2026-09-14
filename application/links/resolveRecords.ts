import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import {
  assets,
  cases,
  documentReferences,
  expenses,
  reimbursements,
  tasks,
  trips,
} from "../../db/schema";
import type { LinkableType, RecordRef } from "../../domain/links/recordLink";
import { canAccess, type Actor } from "../policies/authorize";

export interface ResolvedRecord {
  type: LinkableType;
  id: string;
  /** What to show. Already the household's own title where one exists. */
  label: string;
  /** Where to go. Null when the type has no detail page yet. */
  href: string | null;
}

/**
 * Looks up the far ends of a set of links and decides which of them the
 * actor may see.
 *
 * This is the security-critical part of linking, and the rule is worth
 * stating plainly: **a link is visible only if the actor may read the
 * record at the other end.** Not "may read the record they are looking
 * at" — both. Otherwise a link would leak the existence, and the title, of
 * something the policy kernel refuses to show: a NORMAL task linked to a
 * SENSITIVE document would tell a child account that the document exists
 * and what it is called, which is most of what the sensitivity was
 * protecting.
 *
 * A record that has been deleted simply does not come back. The link table
 * has no foreign key — a generic id cannot reference seven tables — so a
 * dangling row is possible, and it disappears here rather than rendering
 * as a broken entry.
 *
 * One query per type present, not one per link.
 */
export async function resolveRecords(
  actor: Actor,
  householdId: string,
  refs: readonly RecordRef[]
): Promise<Map<string, ResolvedRecord>> {
  const resolved = new Map<string, ResolvedRecord>();
  if (refs.length === 0) return resolved;

  const byType = new Map<LinkableType, string[]>();
  for (const ref of refs) {
    const existing = byType.get(ref.type);
    if (existing) existing.push(ref.id);
    else byType.set(ref.type, [ref.id]);
  }

  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      for (const record of await loadByType(actor, householdId, type, ids)) {
        resolved.set(key(record), record);
      }
    })
  );

  return resolved;
}

export function key(ref: { type: LinkableType; id: string }): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Loads one type's rows and filters them through the policy kernel.
 *
 * Each branch passes the same things the type's own list query does — its
 * visibility, its sensitivity, who created it, and the people it is about
 * — so a link resolves to exactly what the record's own page would show,
 * and cannot become a side door around a narrower rule.
 */
async function loadByType(
  actor: Actor,
  householdId: string,
  type: LinkableType,
  ids: string[]
): Promise<ResolvedRecord[]> {
  switch (type) {
    case "case": {
      const rows = await db
        .select()
        .from(cases)
        .where(and(eq(cases.householdId, householdId), inArray(cases.id, ids)));
      return rows
        .filter((row) => visible(actor, row))
        .map((row) => ({ type, id: row.id, label: row.title, href: `/cases/${row.id}` }));
    }

    case "task": {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.householdId, householdId), inArray(tasks.id, ids)));
      return rows
        .filter((row) => visible(actor, row))
        .map((row) => ({ type, id: row.id, label: row.title, href: "/tasks" }));
    }

    case "expense": {
      const rows = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.householdId, householdId), inArray(expenses.id, ids)));
      return rows
        .filter((row) => visible(actor, row, row.personId))
        .map((row) => ({
          type,
          id: row.id,
          label: row.description,
          href: `/finance?month=${row.incurredOn.slice(0, 7)}`,
        }));
    }

    case "reimbursement": {
      const rows = await db
        .select()
        .from(reimbursements)
        .where(and(eq(reimbursements.householdId, householdId), inArray(reimbursements.id, ids)));
      return rows
        .filter((row) => visible(actor, row))
        .map((row) => ({ type, id: row.id, label: row.title, href: `/finance/claims/${row.id}` }));
    }

    case "trip": {
      const rows = await db
        .select()
        .from(trips)
        .where(and(eq(trips.householdId, householdId), inArray(trips.id, ids)));
      return rows
        .filter((row) => visible(actor, row))
        .map((row) => ({ type, id: row.id, label: row.title, href: `/trips/${row.id}` }));
    }

    case "asset": {
      const rows = await db
        .select()
        .from(assets)
        .where(and(eq(assets.householdId, householdId), inArray(assets.id, ids)));
      return rows
        .filter((row) => visible(actor, row, row.personId))
        .map((row) => ({ type, id: row.id, label: row.name, href: `/assets/${row.id}` }));
    }

    case "document": {
      const rows = await db
        .select()
        .from(documentReferences)
        .where(and(eq(documentReferences.householdId, householdId), inArray(documentReferences.id, ids)));
      return rows
        .filter((row) => visible(actor, row))
        .map((row) => ({
          type,
          id: row.id,
          // The household's own title where there is one — the same rule
          // the documents page follows.
          label: row.titleOverride ?? row.title,
          href: "/documents",
        }));
    }
  }
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

/**
 * A link between two household records.
 *
 * `docs/domain/erd.md` models one of these explicitly —
 * `CASE }o--o{ DOCUMENT_REFERENCE : contextualizes` — and
 * `docs/integrations/integration-contracts.md` lists "context links" among
 * the things a document reference carries. The same need turned up in
 * every phase since: an expense that belongs to a case, a document that
 * justifies a claim, an asset a warranty case is about, a trip a booking
 * confirmation belongs to.
 *
 * **One generic table rather than a join table per pair.** Five
 * linkable types would otherwise be ten join tables, ten authorization
 * paths, and ten places for the same rule to be got subtly wrong. The
 * cost is that the database cannot enforce the foreign key — a generic
 * `targetId` cannot reference five tables at once — which is paid for by
 * resolving every link through a query that only returns rows it actually
 * found, so a dangling link disappears rather than rendering as a broken
 * entry.
 */
export const LINKABLE_TYPES = ["case", "task", "expense", "reimbursement", "trip", "asset", "document"] as const;

export type LinkableType = (typeof LINKABLE_TYPES)[number];

export function isLinkableType(value: string): value is LinkableType {
  return (LINKABLE_TYPES as readonly string[]).includes(value);
}

export interface RecordRef {
  type: LinkableType;
  id: string;
}

export interface RecordLink {
  id: string;
  householdId: string;
  /** Canonically ordered — see `canonicalise`. */
  sourceType: LinkableType;
  sourceId: string;
  targetType: LinkableType;
  targetId: string;
  createdBy: string | null;
  createdAt: Date;
}

export type LinkRejection =
  | { code: "SELF_LINK"; message: string }
  | { code: "UNKNOWN_TYPE"; message: string };

export type LinkResult<T> = { ok: true; value: T } | { ok: false; rejection: LinkRejection };

/**
 * Where a type sits in the canonical order.
 *
 * **Declaration order, not alphabetical.** PostgreSQL compares enum values
 * by the order they were declared in, and the database enforces canonical
 * ordering with a `CHECK` — so comparing type names as strings here would
 * disagree with the constraint for any pair whose alphabetical and
 * declared orders differ. `task` and `expense` are exactly such a pair,
 * and the first draft of this function would have had every task-expense
 * link rejected by the database.
 *
 * Indexing into `LINKABLE_TYPES` makes the two definitions the same one.
 * Adding a new type at the end is therefore safe; inserting one in the
 * middle would re-sort existing rows and needs a migration.
 */
function rankOf(type: LinkableType): number {
  return LINKABLE_TYPES.indexOf(type);
}

/**
 * Puts the two ends in a fixed order.
 *
 * A link is a statement that two things are related, and that statement is
 * symmetric: linking a document to a case and linking a case to a document
 * are the same fact. Storing it in whichever order the caller happened to
 * pass would allow both rows to exist, which means a unique index cannot
 * prevent duplicates and every read has to check two directions.
 */
export function canonicalise(a: RecordRef, b: RecordRef): { source: RecordRef; target: RecordRef } {
  const rankA = rankOf(a.type);
  const rankB = rankOf(b.type);

  if (rankA < rankB || (rankA === rankB && a.id <= b.id)) {
    return { source: a, target: b };
  }
  return { source: b, target: a };
}

export function validateLink(a: RecordRef, b: RecordRef): LinkResult<{ source: RecordRef; target: RecordRef }> {
  if (!isLinkableType(a.type) || !isLinkableType(b.type)) {
    return { ok: false, rejection: { code: "UNKNOWN_TYPE", message: "That kind of record cannot be linked." } };
  }
  if (a.type === b.type && a.id === b.id) {
    return { ok: false, rejection: { code: "SELF_LINK", message: "A record cannot be linked to itself." } };
  }
  return { ok: true, value: canonicalise(a, b) };
}

/**
 * The end of a link that is *not* the record being viewed.
 *
 * Because storage is canonical rather than directional, "the other one"
 * has to be worked out on read: a case's links may hold the case in either
 * column depending on how the type names happened to sort.
 */
export function otherEnd(link: Pick<RecordLink, "sourceType" | "sourceId" | "targetType" | "targetId">, self: RecordRef): RecordRef {
  const isSource = link.sourceType === self.type && link.sourceId === self.id;
  return isSource
    ? { type: link.targetType, id: link.targetId }
    : { type: link.sourceType, id: link.sourceId };
}

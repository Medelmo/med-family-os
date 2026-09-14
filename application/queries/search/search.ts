import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "../../../infrastructure/db/client";
import {
  assets,
  cases,
  documentReferences,
  expenses,
  reimbursements,
  tasks,
  trips,
} from "../../../db/schema";
import { SEARCH_CONFIG } from "../../../db/schema/search";
import type { LinkableType } from "../../../domain/links/recordLink";
import { key, resolveRecords, type ResolvedRecord } from "../../links/resolveRecords";
import type { Actor } from "../../policies/authorize";

export interface SearchHit extends ResolvedRecord {
  type: LinkableType;
}

export interface SearchResults {
  query: string;
  hits: SearchHit[];
  /** The query was empty, so nothing was run. */
  emptyQuery: boolean;
  /** Some type filled its cap, so there may be more than this. */
  truncated: boolean;
}

/**
 * How many rows each type contributes before ranking.
 *
 * Per type rather than overall, so one noisy category cannot crowd out
 * every other — a household with four hundred expenses should still find
 * the case it was looking for. The cap is applied before authorization
 * filtering, so a reader who may see less gets fewer results rather than a
 * slower query; for a household of a handful of people that is the right
 * trade.
 */
const PER_TYPE_LIMIT = 20;

/**
 * Global search (product-spec.md, "Retrieve": "Global search and
 * contextual links make information discoverable"; screen-inventory.md §4).
 *
 * PostgreSQL full-text search over generated, GIN-indexed `tsvector`
 * columns, per ADR-003 and ADR-022. There is no second copy of the truth
 * and nothing to keep in sync: the index is maintained by the database
 * from the row itself, so a title edited by any path — a form, an import,
 * a sync run, a hand-run UPDATE — is searchable immediately and by
 * definition.
 *
 * **This function never selects a title.** It asks the database which rows
 * match and how well, and then hands the bare ids to `resolveRecords`,
 * which is the one place that decides what a record is called, where it
 * lives, and whether this actor may see it at all. That is deliberate: a
 * search that returned titles the reader cannot open would be a way to
 * enumerate the household's sensitive records, which is most of what a
 * sensitivity level protects — and the surest way to never leak a title is
 * to never load one. It also means search and links cannot drift apart:
 * they are the same authorization code, not two copies of it.
 */
export async function search(actor: Actor, householdId: string, rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim();

  if (query.length === 0) {
    return { query, hits: [], emptyQuery: true, truncated: false };
  }

  /**
   * `websearch_to_tsquery`, not `to_tsquery`.
   *
   * `to_tsquery` raises a syntax error on ordinary human input — `a & | b`,
   * a stray quote, a trailing operator — which from a search box means the
   * page 500s because somebody typed. `websearch_to_tsquery` never throws,
   * and it understands the syntax people already know from every other
   * search box: quoted phrases, `or`, and `-` to exclude.
   */
  const tsQuery = sql`websearch_to_tsquery(${SEARCH_CONFIG}, ${query})`;

  const [taskRows, caseRows, expenseRows, claimRows, tripRows, assetRows, documentRows] = await Promise.all([
    matchIds("task", tasks.id, tasks.searchVector, tsQuery, eq(tasks.householdId, householdId)),
    matchIds("case", cases.id, cases.searchVector, tsQuery, eq(cases.householdId, householdId)),
    matchIds(
      "expense",
      expenses.id,
      expenses.searchVector,
      tsQuery,
      and(eq(expenses.householdId, householdId), isNull(expenses.archivedAt))
    ),
    matchIds(
      "reimbursement",
      reimbursements.id,
      reimbursements.searchVector,
      tsQuery,
      eq(reimbursements.householdId, householdId)
    ),
    matchIds("trip", trips.id, trips.searchVector, tsQuery, eq(trips.householdId, householdId)),
    matchIds(
      "asset",
      assets.id,
      assets.searchVector,
      tsQuery,
      and(eq(assets.householdId, householdId), isNull(assets.disposedOn))
    ),
    matchIds(
      "document",
      documentReferences.id,
      documentReferences.searchVector,
      tsQuery,
      and(eq(documentReferences.householdId, householdId), isNull(documentReferences.archivedAt))
    ),
  ]);

  const perType = [taskRows, caseRows, expenseRows, claimRows, tripRows, assetRows, documentRows];
  const matched = perType.flat();

  // One ranked list rather than seven, for the same reason Attention is one
  // list: the reader is looking for a thing, not for a category.
  matched.sort((a, b) => b.rank - a.rank);

  const resolved = await resolveRecords(
    actor,
    householdId,
    matched.map(({ type, id }) => ({ type, id }))
  );

  const hits: SearchHit[] = [];
  for (const candidate of matched) {
    const record = resolved.get(key(candidate));
    // Absent means the policy kernel refused it. Silently, and without a
    // count: "3 results you may not see" is itself the disclosure.
    if (record) hits.push(record);
  }

  return {
    query,
    hits,
    emptyQuery: false,
    truncated: perType.some((rows) => rows.length === PER_TYPE_LIMIT),
  };
}

interface MatchedRow {
  type: LinkableType;
  id: string;
  rank: number;
}

/**
 * The best-matching ids of one type, and nothing else.
 *
 * Ordering happens in the database so the `LIMIT` keeps the *most
 * relevant* rows rather than an arbitrary twenty. `id` breaks rank ties:
 * ids are UUIDv7, so a tie resolves to newest-last but, more importantly,
 * resolves the same way every time — an unstable order would make the same
 * query return different results on consecutive runs.
 */
async function matchIds(
  type: LinkableType,
  idColumn: PgColumn,
  vectorColumn: PgColumn,
  tsQuery: SQL,
  scope: SQL | undefined
): Promise<MatchedRow[]> {
  const rank = sql<number>`ts_rank(${vectorColumn}, ${tsQuery})`;

  const rows = await db
    .select({ id: idColumn, rank })
    .from(idColumn.table)
    .where(and(scope, sql`${vectorColumn} @@ ${tsQuery}`))
    .orderBy(sql`${rank} desc, ${idColumn} asc`)
    .limit(PER_TYPE_LIMIT);

  return rows.map((row) => ({ type, id: row.id as string, rank: Number(row.rank) }));
}

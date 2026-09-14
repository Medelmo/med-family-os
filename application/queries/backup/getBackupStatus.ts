import { and, count, desc, eq, getTableName, max, sql } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import {
  assets,
  auditEvents,
  budgets,
  calendarEvents,
  cases,
  documentReferences,
  expenses,
  maintenanceRecords,
  people,
  recordLinks,
  reimbursements,
  tasks,
  tripItems,
  trips,
  warranties,
} from "../../../db/schema";
import { logger } from "../../../infrastructure/logging/logger";
import { isKeyringConfigured } from "../../../infrastructure/crypto/keyring";
import { authorizeHouseholdSettingsAccess } from "../../policies/household";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

/**
 * What this application can honestly say about backups (screen 49).
 *
 * **It does not take the backups, and this page does not pretend to.**
 * `docs/backup/backup-restore.md` puts the backup layers in the
 * household's homelab — a logical dump, a volume snapshot, a documented
 * secret-recovery procedure — and CLAUDE.md §0 is explicit that this app
 * is not a replacement for infrastructure it does not own. A green
 * "Backups: healthy" tick for a job this process cannot see would be the
 * worst thing on the page: a reassurance with nothing behind it, believed
 * precisely until the day it mattered.
 *
 * So this reports two kinds of fact, and nothing else:
 *
 * 1. **What is in the database right now.** Counts and newest timestamps
 *    per table, the schema version, the size on disk. These are exactly
 *    what steps 5 and 6 of the restore drill ask for — "run integrity
 *    checks, verify representative records" — and they are unanswerable
 *    without a number to compare against. Written down before a restore,
 *    they make the restore verifiable rather than hopeful.
 *
 * 2. **What the household is responsible for**, including the one thing
 *    it is easy to get catastrophically right-looking and wrong: the
 *    credential keys must *not* be inside the database backup, or the
 *    encryption at rest protects nothing against the attacker who has the
 *    dump (ADR-019, and the brief's "assume backups may eventually be
 *    accessed by an attacker").
 */

export interface TableStat {
  table: string;
  /** Null when the count failed — distinct from zero, deliberately. */
  rows: number | null;
  /** Newest `created_at`, so a restored copy can be checked for staleness. */
  newest: Date | null;
}

export interface BackupStatus {
  takenAt: Date;
  schemaVersion: string | null;
  schemaAppliedAt: Date | null;
  /** Bytes, from PostgreSQL. Null when the database refuses to say. */
  databaseBytes: number | null;
  tables: TableStat[];
  totalRows: number;
  /** The most recent export of this household, from the audit trail. */
  lastExport: { at: Date; actorUserId: string | null } | null;
  /**
   * Whether `CREDENTIAL_KEYS` is configured. Only ever whether — the value
   * itself never leaves `infrastructure/crypto/keyring.ts`.
   */
  keyringConfigured: boolean;
}

/**
 * Tables worth counting, in the order a person would check them.
 *
 * **The schema objects, not their names.** A hand-typed list is how the
 * first version of this got two entries wrong: the cases table is called
 * `household_case` — `case` is a reserved word — and there is no `note`
 * table at all. Both queries failed, the `catch` below turned each into a
 * confident "0 rows", and the page reported that a household with cases in
 * it had none. A wrong number on a page whose entire purpose is verifying
 * a restore is worse than no page.
 *
 * Taking the names from the schema means they cannot be mistyped and
 * cannot go stale through a rename. It also removes the question of
 * whether a name reaching an identifier position is trusted: these are the
 * same objects every query in the application is built from.
 *
 * Chosen explicitly rather than enumerated from the database, though: a
 * list derived from `information_schema` would quietly grow to include
 * session and rate-limit tables, and "how many revoked sessions are there"
 * is not what somebody verifying a restore is asking.
 */
const COUNTED_TABLES = [
  people,
  tasks,
  cases,
  calendarEvents,
  expenses,
  reimbursements,
  budgets,
  trips,
  tripItems,
  assets,
  warranties,
  maintenanceRecords,
  documentReferences,
  recordLinks,
  auditEvents,
] as const;

export async function getBackupStatus(actor: Actor, householdId: string): Promise<BackupStatus> {
  // **Owner or admin, which is stricter than the settings row this page
  // sits under.** `docs/permissions.md` gives an ADULT "limited" access to
  // household settings, implemented as read-only — and read-only is
  // exactly the wrong shape here, because everything on this page *is* a
  // read of the whole household.
  //
  // Row counts are not a setting. "There are 14 documents" told to an
  // adult who can open three of them is a disclosure the rest of the
  // application spends considerable effort avoiding; it is the aggregate
  // version of the enumeration that search and links are both careful not
  // to allow. So this asks for the update-level access only an owner or
  // admin has, and `docs/permissions.md` now carries its own row saying so.
  if (!authorizeHouseholdSettingsAccess(actor, "update", householdId)) {
    throw new AuthorizationError("Only an owner or admin may view backup status.");
  }

  const [tables, schema, size, lastExport] = await Promise.all([
    countTables(householdId),
    latestMigration(),
    databaseSize(),
    latestExport(householdId),
  ]);

  return {
    takenAt: new Date(),
    schemaVersion: schema?.hash ?? null,
    schemaAppliedAt: schema?.at ?? null,
    databaseBytes: size,
    tables,
    totalRows: tables.reduce((total, t) => total + (t.rows ?? 0), 0),
    lastExport,
    keyringConfigured: isKeyringConfigured(),
  };
}

/**
 * One query per table rather than one union, so a table that a future
 * migration drops costs a gap on this page instead of the whole page.
 *
 * Drizzle builds the `from` clause from the table object, so no string
 * reaches an identifier position and the reserved-word problem that
 * `household_case` exists to avoid cannot recur here either.
 */
async function countTables(householdId: string): Promise<TableStat[]> {
  const stats: TableStat[] = [];

  for (const table of COUNTED_TABLES) {
    const name = getTableName(table);

    try {
      const [row] = await db
        .select({ rows: count(), newest: max(table.createdAt) })
        .from(table)
        .where(eq(table.householdId, householdId));

      stats.push({ table: name, rows: Number(row?.rows ?? 0), newest: row?.newest ?? null });
    } catch (error) {
      // Reported as unknown rather than as zero, and logged.
      //
      // The first version pushed `rows: 0` here, which is how a table name
      // that did not exist became a page confidently stating a household
      // had no cases. On a page whose whole purpose is verifying a
      // restore, "I could not count this" and "there are none" must not
      // look the same.
      logger.warn({ event: "backup.count_failed", table: name, err: error }, "could not count a table");
      stats.push({ table: name, rows: null, newest: null });
    }
  }

  return stats;
}

async function latestMigration(): Promise<{ hash: string; at: Date } | null> {
  try {
    const result = await db.execute(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`
    );
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {
      // The first twelve characters are plenty to compare two deployments
      // by eye, which is what this is for.
      hash: String(row.hash).slice(0, 12),
      at: new Date(Number(row.created_at)),
    };
  } catch {
    return null;
  }
}

async function databaseSize(): Promise<number | null> {
  try {
    const result = await db.execute(sql`select pg_database_size(current_database())::bigint as bytes`);
    const row = rowsOf(result)[0];
    return row ? Number(row.bytes) : null;
  } catch {
    // Some managed deployments refuse this. A missing number is better
    // than a page that fails.
    return null;
  }
}

async function latestExport(householdId: string): Promise<{ at: Date; actorUserId: string | null } | null> {
  const [row] = await db
    .select({ at: auditEvents.createdAt, actorUserId: auditEvents.actorUserId })
    .from(auditEvents)
    .where(and(eq(auditEvents.householdId, householdId), eq(auditEvents.action, "household.exported")))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);

  return row ?? null;
}

/** postgres.js returns an array; other drivers wrap it in `{ rows }`. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<string, unknown>[];
}

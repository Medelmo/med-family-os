import { getTableName, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "../../infrastructure/db/client";
import * as schema from "../../db/schema";

/**
 * Empties every domain table, for tests that need a known-empty database.
 *
 * The table list is *derived from the schema* rather than written out. It
 * used to be spelled out by hand in six places, and each new phase meant
 * remembering to add its tables to all of them — a chore whose failure
 * mode is quiet: a forgotten table leaves rows behind, and the test that
 * breaks is some unrelated one in a later file that suddenly sees data it
 * did not create. Deriving it means a table cannot be forgotten, because
 * nobody has to remember it.
 *
 * `cascade` handles ordering, so no dependency order is needed here
 * either.
 *
 * Points at whatever DATABASE_URL names. Use a disposable development
 * database, never a shared or production one.
 */
export async function resetDatabase(): Promise<void> {
  // `as unknown[]` only to widen away the schema module's very specific
  // per-table types, which a `value is PgTable` predicate is not
  // assignable to.
  const tables = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => value instanceof PgTable)
    .map((table) => sql.identifier(getTableName(table)));

  if (tables.length === 0) throw new Error("No tables found in db/schema — refusing to run a no-op reset.");

  await db.execute(sql`truncate table ${sql.join(tables, sql`, `)} cascade`);

  // The sign-in rate limiter's table (ADR-009) is owned by
  // rate-limiter-flexible, not by the Drizzle schema, so it survives the
  // truncate above. Left alone, attempts accumulate across consecutive
  // runs inside the limiter's window until sign-in starts failing for
  // reasons unrelated to the code under test. This resets test state; the
  // production thresholds are untouched.
  await db.execute(sql`
    do $$ begin
      if to_regclass('public.rate_limit_auth') is not null then
        execute 'truncate table rate_limit_auth';
      end if;
    end $$;
  `);
}

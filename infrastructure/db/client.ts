import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

declare global {
  var __medFamilyOsSql: ReturnType<typeof postgres> | undefined;
  var __medFamilyOsDb: PostgresJsDatabase<typeof schema> | undefined;
}

/**
 * The database handle, connected on first use rather than on import.
 *
 * **Why lazily.** This module used to throw at import time when
 * `DATABASE_URL` was unset, which reads as strict and is in fact a design
 * error: `next build` imports every route module to collect its
 * configuration, so the whole application became unbuildable without a
 * live database URL.
 *
 * That was not a theoretical problem. It meant the Dockerfile had never
 * produced an image — the build stage has no database and no business
 * having one, and the failure only appeared the first time anybody ran
 * `docker build`. A build that needs a runtime secret is a build that
 * cannot happen in a pipeline that is correctly denied one.
 *
 * Nothing is given up. The error still fires, with the same message, the
 * first time anything actually asks for a connection — which in a running
 * application is the first request, and in a misconfigured deployment is
 * immediately. The readiness endpoint reports it rather than the process
 * dying on import, which is the better failure anyway: a container that
 * exits before it can answer `/api/ready` tells an operator nothing.
 */
function connect(): PostgresJsDatabase<typeof schema> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set (see .env.example).");
  }

  // Reuse the connection across Next.js dev-server hot reloads instead of
  // opening a new pool on every module reload (a well-known Next.js +
  // serverless-Postgres-client footgun).
  const sql = globalThis.__medFamilyOsSql ?? postgres(url, { max: 10 });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__medFamilyOsSql = sql;
  }

  return drizzle(sql, { schema });
}

function handle(): PostgresJsDatabase<typeof schema> {
  const existing = globalThis.__medFamilyOsDb;
  if (existing) return existing;

  const created = connect();
  globalThis.__medFamilyOsDb = created;
  return created;
}

/**
 * Looks and behaves exactly like the drizzle handle it stands in for, and
 * every call goes through `handle()`.
 *
 * A Proxy rather than a `getDb()` function every call site has to
 * remember: there are several hundred uses of `db` across the application,
 * and a rule that has to be applied at each of them is a rule that will
 * eventually be missed. This way there is no call site to get wrong, and
 * `db` keeps the type it always had.
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, property, receiver) {
    return Reflect.get(handle(), property, receiver);
  },
  // `db.transaction(...)` and friends are ordinary property reads, but
  // `apply`/`has`/`set` are forwarded too so the stand-in cannot behave
  // differently from the real thing in some corner nobody thought about.
  has(_target, property) {
    return Reflect.has(handle(), property);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(handle());
  },
});

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * The type of `tx` inside `db.transaction(async (tx) => ...)`. Not
 * assignable to/from `Database` itself (drizzle-orm's `PgTransaction` and
 * `PostgresJsDatabase` are structurally different — the transaction handle
 * lacks `$client`), so anything that must accept "either the top-level db
 * or an in-flight transaction" (e.g. application/audit/recordAuditEvent.ts)
 * needs this as a separate type, not `Database`.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

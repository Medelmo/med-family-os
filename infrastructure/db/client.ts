import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

declare global {
  var __medFamilyOsSql: ReturnType<typeof postgres> | undefined;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set (see .env.example).");
}

// Reuse the connection across Next.js dev-server hot reloads instead of
// opening a new pool on every module reload (a well-known Next.js +
// serverless-Postgres-client footgun).
const sql = globalThis.__medFamilyOsSql ?? postgres(process.env.DATABASE_URL, { max: 10 });

if (process.env.NODE_ENV !== "production") {
  globalThis.__medFamilyOsSql = sql;
}

export const db = drizzle(sql, { schema });
export type Database = typeof db;

/**
 * The type of `tx` inside `db.transaction(async (tx) => ...)`. Not
 * assignable to/from `Database` itself (drizzle-orm's `PgTransaction` and
 * `PostgresJsDatabase` are structurally different — the transaction handle
 * lacks `$client`), so anything that must accept "either the top-level db
 * or an in-flight transaction" (e.g. application/audit/recordAuditEvent.ts)
 * needs this as a separate type, not `Database`.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

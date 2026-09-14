import { sql } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import { auditEvents, households, householdMemberships, people, sessionRevocations, users } from "../../db/schema";

/**
 * Resets the database before the E2E suite so it starts from the genuine
 * first-run state — the suite's first journey is ADR-012's one-time
 * bootstrap, which cannot be re-run against an already-initialised
 * household.
 *
 * Points at whatever DATABASE_URL names, and truncates every domain table,
 * exactly like tests/integration/household-lifecycle.spec.ts. Use a
 * disposable development database, never a shared or production one.
 */
export default async function globalSetup() {
  await db.execute(
    sql`truncate table ${auditEvents}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );
}

import { sql } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
  deadlines,
  households,
  householdMemberships,
  inboxItems,
  notifications,
  outboxEvents,
  people,
  sessionRevocations,
  taskPeople,
  tasks,
  users,
} from "../../db/schema";

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
    sql`truncate table ${notifications}, ${outboxEvents}, ${auditEvents}, ${deadlines}, ${taskPeople}, ${tasks}, ${inboxItems}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );

  // Also clear the sign-in rate limiter's counters (ADR-009). Its table is
  // owned by rate-limiter-flexible rather than the Drizzle schema, so it
  // survives the truncate above — which meant attempts accumulated across
  // consecutive suite runs inside the limiter's 15-minute window until
  // sign-in started failing for reasons that had nothing to do with the
  // code under test. Resetting test state, not relaxing the limit: the
  // production thresholds stay exactly as they are.
  await db.execute(sql`
    do $$ begin
      if to_regclass('public.rate_limit_auth') is not null then
        execute 'truncate table rate_limit_auth';
      end if;
    end $$;
  `);
}

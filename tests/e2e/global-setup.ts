import { resetDatabase } from "../support/database";

/**
 * Resets the database before the E2E suite so it starts from the genuine
 * first-run state — the suite's first journey is ADR-012's one-time
 * bootstrap, which cannot be re-run against an already-initialised
 * household.
 *
 * Shares one derived table list with the integration suite (see
 * tests/support/database.ts) rather than keeping a second hand-written
 * copy that a later phase could forget to update.
 *
 * Points at whatever DATABASE_URL names. Use a disposable development
 * database, never a shared or production one.
 */
export default async function globalSetup() {
  await resetDatabase();
}

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { integrationConnections, syncRuns } from "../../../db/schema";
import { isStaleRun, isSyncLive, retryDueAt, scheduledDueAt } from "../../../domain/integrations/syncSchedule";
import { applySyncCommand, type SyncRun } from "../../../domain/integrations/syncRun";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { logger } from "../../../infrastructure/logging/logger";
import { IntegrationRuleError } from "./connectionCommands";
import { retrySyncRun, runScheduledSync, type SyncOptions } from "./runSync";

export interface SyncScanResult {
  /** Live runs presumed dead and marked FAILED. */
  reaped: number;
  /** Connections whose interval has elapsed. */
  scheduled: number;
  /** Failed runs picked back up. */
  retried: number;
  /** Runs that ended FAILED or PARTIAL this pass. */
  unsuccessful: number;
}

/**
 * One pass of the sync scheduler (ADR-023).
 *
 * Runs on the same in-process worker as the outbox drain and the reminder
 * scan (ADR-013) — for the same reasons, and there is now a third: this
 * loop is the only thing in the application that makes an outbound request
 * with no person waiting on it, so it belongs where the other unattended
 * work already is and is switched off by the same flag.
 *
 * Three jobs, in order, because each depends on the last:
 *
 * 1. **Reap.** A run that claims a connection and never finishes would
 *    block it forever, because a live run *is* the claim.
 * 2. **Retry.** A failed run within its attempt budget and past its
 *    backoff is picked back up on the same row.
 * 3. **Schedule.** A connection whose interval has elapsed gets a fresh
 *    run.
 *
 * Each connection gets at most one of the three per pass, and a failure in
 * one connection never stops the others: a household with a broken
 * Nextcloud must still sync its Paperless.
 */
export async function scanForSyncs(now: Date = new Date(), options: SyncOptions = {}): Promise<SyncScanResult> {
  const result: SyncScanResult = { reaped: 0, scheduled: 0, retried: 0, unsuccessful: 0 };

  const connections = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.enabled, true));

  if (connections.length === 0) return result;

  const latest = await latestRunPerConnection(connections.map((c) => c.id));

  for (const connection of connections) {
    const run = latest.get(connection.id);

    try {
      if (run && isSyncLive(run.status)) {
        if (isStaleRun(run, now)) {
          await reap(connection.householdId, run, now);
          result.reaped += 1;
        }
        // Live, stale or not, this connection is spoken for this pass.
        continue;
      }

      if (run && run.status === "FAILED") {
        const dueAt = retryDueAt(run);
        if (dueAt && dueAt <= now) {
          const outcome = await retrySyncRun(connection.householdId, run.id, { ...options, now });
          result.retried += 1;
          if (outcome.status !== "SUCCEEDED") result.unsuccessful += 1;
          continue;
        }
      }

      const dueAt = scheduledDueAt(connection);
      if (dueAt && dueAt <= now) {
        const outcome = await runScheduledSync(connection.householdId, connection.id, { ...options, now });
        result.scheduled += 1;
        if (outcome.status !== "SUCCEEDED") result.unsuccessful += 1;
      }
    } catch (error) {
      // A connection that cannot even be started — switched off between
      // the query and now, no adapter, no stored credential, or beaten to
      // its slot by another worker — is logged and stepped over. It must
      // not take the rest of the household's integrations down with it.
      //
      // `error.message` is safe to log here because every one of these is
      // this application's own text (IntegrationRuleError, or the fixed
      // table in runSync); a provider's own error message never reaches
      // this point, which is the rule that stopped a credential leaking
      // into a sync run in Phase 7.
      const expected = error instanceof IntegrationRuleError;
      logger[expected ? "debug" : "error"](
        {
          event: "sync.scheduler_skipped",
          connectionId: connection.id,
          provider: connection.provider,
          reason: expected ? (error as IntegrationRuleError).code : "unexpected",
          err: expected ? undefined : error,
        },
        "scheduled sync skipped"
      );
    }
  }

  return result;
}

/**
 * The newest run for each of these connections.
 *
 * One query rather than one per connection. Ordering is by `createdAt`
 * then `id`: ids are UUIDv7, so within the same millisecond the later
 * insert still sorts later, and the answer is never arbitrary.
 */
async function latestRunPerConnection(connectionIds: string[]): Promise<Map<string, SyncRun>> {
  const rows = await db
    .select()
    .from(syncRuns)
    .where(inArray(syncRuns.connectionId, connectionIds))
    .orderBy(desc(syncRuns.createdAt), desc(syncRuns.id));

  const byConnection = new Map<string, SyncRun>();
  for (const row of rows) {
    if (!byConnection.has(row.connectionId)) {
      byConnection.set(row.connectionId, row as unknown as SyncRun);
    }
  }
  return byConnection;
}

/**
 * Gives up on a run whose process is gone.
 *
 * Marked FAILED rather than deleted — what happened is part of the record
 * — with an error kind of its own so "this was interrupted" is
 * distinguishable from "the provider refused us". Being FAILED also makes
 * it retryable on a later pass, which is the right outcome: the work still
 * needs doing.
 */
async function reap(householdId: string, run: SyncRun, now: Date): Promise<void> {
  const fail = { type: "FAIL", errorKind: "abandoned", errorMessage: ABANDONED_MESSAGE } as const;

  // Only RUNNING may go straight to FAILED. A corpse found in PENDING or
  // RETRYING is walked through START first — the row is dead either way,
  // and going through the machine beats writing a status by hand that the
  // machine would have refused.
  let state = run;
  if (!applySyncCommand(state, fail, now).ok) {
    const started = applySyncCommand(state, { type: "START" }, now);
    if (!started.ok) return;
    const [row] = await db
      .update(syncRuns)
      .set(started.transition.patch)
      .where(eq(syncRuns.id, state.id))
      .returning();
    state = row as unknown as SyncRun;
  }

  const result = applySyncCommand(state, fail, now);
  if (!result.ok) return;

  await db.update(syncRuns).set(result.transition.patch).where(eq(syncRuns.id, state.id));

  await recordAuditEvent({
    householdId,
    actorUserId: null,
    action: "sync.abandoned",
    resourceType: "sync_run",
    resourceId: state.id,
    metadata: { trigger: "SCHEDULE" },
  });

  logger.warn({ event: "sync.abandoned", runId: state.id }, "reaped a sync run whose process is gone");
}

const ABANDONED_MESSAGE = "This run was interrupted and did not finish.";

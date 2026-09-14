import type { SyncRunStatus } from "./syncRun";

/**
 * When a sync should happen without anybody asking for it.
 *
 * `docs/domain/state-machines.md` has always contained
 * `FAILED -> RETRYING -> RUNNING`, and `CLAUDE.md` §9 requires every
 * adapter to define a retry policy. Until now nothing drove either: the
 * machine was implemented and tested, and the only thing that could move a
 * run through it was a person pressing "Sync now". A retry policy nothing
 * enacts is a comment.
 *
 * Every decision here is a pure function of a row and a clock, so the
 * scheduler can be tested without a provider, a timer, or a network.
 */

/**
 * How many times a failing connection is retried before it is left alone.
 *
 * Five, matching the outbox (`processOutbox.MAX_ATTEMPTS`). After that the
 * run stays `FAILED`, visible on the integrations page with its error, and
 * a person can press "Sync now" — which starts a fresh run rather than
 * continuing the exhausted one. Retrying forever would turn one
 * misconfigured connection into a permanent, silent source of outbound
 * requests against somebody else's server.
 */
export const MAX_SYNC_ATTEMPTS = 5;

/**
 * Retry backoff: 5, 10, 20, 40 minutes.
 *
 * Much slower than the outbox's seconds-scale backoff, deliberately. An
 * outbox event is this application's own work and retrying costs a query;
 * a sync is a request to somebody else's server, and the most likely
 * reasons for failure — the NAS is asleep, the container is restarting,
 * the token has expired — are not resolved by asking again in ten seconds.
 * Patience here is politeness.
 */
const RETRY_BASE_MS = 5 * 60_000;

export function retryBackoffMs(attempt: number): number {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
}

/**
 * The floor on how often a connection may poll.
 *
 * A household that sets "every minute" has not thought about the machine
 * at the other end, and this app should not be the thing that hammers
 * their Paperless. Fifteen minutes is far below any plausible need —
 * documents scanned at home are not urgent — and the database enforces it
 * too, so no other write path can set a smaller one.
 */
export const MIN_SYNC_INTERVAL_MINUTES = 15;

/**
 * How long a `RUNNING` run may go before it is presumed dead.
 *
 * A run is claimed by existing, and only one may be live per connection
 * (see the partial unique index in `db/schema/integrations.ts`). That is
 * what stops two syncs racing — and it is also what would wedge a
 * connection forever if the process died mid-run, because the abandoned
 * `RUNNING` row would block every future one.
 *
 * So a run older than this is reaped into `FAILED`, which the machine
 * already allows from `RUNNING`, and which makes it retryable like any
 * other failure. Twenty minutes is comfortably longer than the bounded
 * ten pages a run may take with the provider timeout on each, so a slow
 * but living sync is never mistaken for a dead one.
 */
export const STALE_RUN_MS = 20 * 60_000;

/** A run that currently holds its connection's single live slot. */
export function isSyncLive(status: SyncRunStatus): boolean {
  return status === "PENDING" || status === "RUNNING" || status === "RETRYING";
}

export interface SchedulableRun {
  status: SyncRunStatus;
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * Whether an abandoned run should be given up on.
 *
 * Measured from `startedAt` rather than from the row's creation: a run
 * that sat `PENDING` briefly and then ran for nineteen minutes has been
 * running for nineteen, not twenty. A live-looking run with no
 * `startedAt` at all is a row that never got out of `PENDING`, which
 * means the process died between the insert and the first transition —
 * also stale, and reaped on the same rule so it cannot wedge the
 * connection either.
 */
export function isStaleRun(run: SchedulableRun, now: Date): boolean {
  if (!isSyncLive(run.status)) return false;
  const since = run.startedAt ?? run.finishedAt;
  if (!since) return true;
  return now.getTime() - since.getTime() >= STALE_RUN_MS;
}

/**
 * When a failed run becomes eligible for another attempt, or null if it
 * never will.
 *
 * `null` for anything that is not a spent `FAILED` run: a `PARTIAL` run
 * succeeded at something and its remainder is the *next* scheduled run's
 * job, not a retry of this one, and a `SUCCEEDED` run has nothing to
 * retry.
 */
export function retryDueAt(run: SchedulableRun): Date | null {
  if (run.status !== "FAILED") return null;
  if (run.attempt >= MAX_SYNC_ATTEMPTS) return null;
  if (!run.finishedAt) return null;
  return new Date(run.finishedAt.getTime() + retryBackoffMs(run.attempt));
}

export interface SchedulableConnection {
  enabled: boolean;
  syncIntervalMinutes: number | null;
  lastSyncAt: Date | null;
}

/**
 * When the next unprompted sync is due, or null if there should not be
 * one.
 *
 * A null interval means manual only, and is the default: a migration
 * should not quietly start making outbound requests on behalf of
 * connections whose owners never asked for them.
 *
 * A connection that has never synced is due immediately. That is the
 * useful reading — somebody has just set an interval and expects
 * something to happen — and it costs one request.
 */
export function scheduledDueAt(connection: SchedulableConnection): Date | null {
  if (!connection.enabled) return null;
  if (connection.syncIntervalMinutes === null) return null;
  if (!connection.lastSyncAt) return new Date(0);
  return new Date(connection.lastSyncAt.getTime() + connection.syncIntervalMinutes * 60_000);
}

export type SyncTrigger = "MANUAL" | "SCHEDULE" | "RETRY";

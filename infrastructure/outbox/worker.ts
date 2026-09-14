import { processOutbox } from "../../application/outbox/processOutbox";
import { scanForReminders } from "../../application/reminders/scanForReminders";
import { scanForSyncs } from "../../application/commands/integrations/scanForSyncs";
import { logger } from "../logging/logger";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 10_000);

// The reminder scan runs far less often than the outbox drain: it is
// looking for dates that have passed, and a follow-up noticed within a
// minute is indistinguishable from one noticed instantly, while a query
// across every waiting task and case every ten seconds is pure waste.
const REMINDER_SCAN_INTERVAL_MS = Number(process.env.REMINDER_SCAN_INTERVAL_MS ?? 60_000);

// Slower again, and for a stronger reason than waste: this is the one
// loop that makes requests to somebody else's server (ADR-023). The
// shortest interval a household may configure is fifteen minutes, so
// checking every five is already three times more often than the most
// eager connection can possibly be due.
const SYNC_SCAN_INTERVAL_MS = Number(process.env.SYNC_SCAN_INTERVAL_MS ?? 300_000);

declare global {
  var __medFamilyOsOutboxWorkerStarted: boolean | undefined;
}

/**
 * Polling loop for the transactional outbox (ADR-013).
 *
 * Uses a global flag rather than a module-level one: Next.js's dev server
 * re-evaluates modules on hot reload, which would otherwise start a second
 * loop on every edit until the machine had a dozen of them polling.
 *
 * Errors are logged and swallowed deliberately — a failing batch must not
 * kill the loop, or one bad event would stop every later one from ever
 * being delivered. Per-event failure handling (backoff, terminal FAILED
 * state) lives in processOutbox.
 */
export function startOutboxWorker(): void {
  if (globalThis.__medFamilyOsOutboxWorkerStarted) return;
  globalThis.__medFamilyOsOutboxWorkerStarted = true;

  logger.info({ event: "outbox.worker_started", pollIntervalMs: POLL_INTERVAL_MS }, "outbox worker started");

  const tick = async () => {
    try {
      const result = await processOutbox();
      if (result.claimed > 0) {
        logger.info({ event: "outbox.batch", ...result }, "processed an outbox batch");
      }
    } catch (error) {
      logger.error({ event: "outbox.worker_error", err: error }, "outbox worker batch threw");
    }
  };

  const scan = async () => {
    try {
      const result = await scanForReminders();
      const total = result.taskFollowUps + result.caseFollowUps + result.deadlines;
      if (total > 0) {
        logger.info({ event: "reminders.scanned", ...result }, "reminder scan emitted events");
      }
    } catch (error) {
      // Same reasoning as the outbox tick: a failing scan must not kill
      // the loop, or one bad row would stop every future reminder.
      logger.error({ event: "reminders.scan_error", err: error }, "reminder scan threw");
    }
  };

  const syncScan = async () => {
    try {
      const result = await scanForSyncs();
      const touched = result.reaped + result.scheduled + result.retried;
      if (touched > 0) {
        logger.info({ event: "sync.scanned", ...result }, "sync scheduler acted");
      }
    } catch (error) {
      // Same reasoning as the other two: one bad connection must not stop
      // every future pass. Per-connection failures are already caught
      // inside scanForSyncs; this catches the query itself.
      logger.error({ event: "sync.scan_error", err: error }, "sync scan threw");
    }
  };

  const outboxTimer = setInterval(tick, POLL_INTERVAL_MS);
  const reminderTimer = setInterval(scan, REMINDER_SCAN_INTERVAL_MS);
  const syncTimer = setInterval(syncScan, SYNC_SCAN_INTERVAL_MS);
  // Don't hold the process open purely for the poll timers.
  outboxTimer.unref?.();
  reminderTimer.unref?.();
  syncTimer.unref?.();

  void tick();
  void scan();
  // Deliberately *not* run immediately, unlike the other two. A restart
  // must not become a reason to call somebody else's server: a container
  // that crash-loops would otherwise sync on every boot, and the work is
  // due within five minutes anyway.
  //
  // The reap is delayed by the same five minutes, which is correct — a
  // run abandoned by the process that just died is not stale until
  // STALE_RUN_MS has passed regardless.
}

import { processOutbox } from "../../application/outbox/processOutbox";
import { logger } from "../logging/logger";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 10_000);

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

  const timer = setInterval(tick, POLL_INTERVAL_MS);
  // Don't hold the process open purely for the poll timer.
  timer.unref?.();

  void tick();
}

import { sql } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import { outboxEvents } from "../../db/schema";
import { logger } from "../../infrastructure/logging/logger";
import { OUTBOX_HANDLERS } from "./handlers";
import type { OutboxEventType } from "./emitOutboxEvent";

export const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5_000;

/** Exponential backoff: 5s, 10s, 20s, 40s, 80s. */
export function backoffMs(attempts: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
}

export interface OutboxRunResult {
  claimed: number;
  processed: number;
  failed: number;
  retrying: number;
}

/**
 * Processes one batch of due outbox events (ADR-004 / ADR-013).
 *
 * Each event is claimed and handled inside its own transaction, using
 * `FOR UPDATE SKIP LOCKED` so a second worker — a rolling restart, a
 * developer's `pnpm dev` pointed at the same database — takes different
 * rows rather than the same ones. That, plus handler-level idempotency
 * (see handlers.ts), is what makes at-least-once delivery safe.
 */
export async function processOutbox(batchSize = 20, now: Date = new Date()): Promise<OutboxRunResult> {
  const result: OutboxRunResult = { claimed: 0, processed: 0, failed: 0, retrying: 0 };

  for (let i = 0; i < batchSize; i++) {
    const handled = await processOne(now, result);
    if (!handled) break;
  }

  return result;
}

async function processOne(now: Date, result: OutboxRunResult): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Claimed against the database's own clock, not the application's.
    // `next_attempt_at` is written by the database (defaultNow, and the
    // backoff below), so comparing it to a JS `new Date()` mixes two
    // clocks — and they do drift: the Postgres container here ran ~0.4s
    // ahead of the host, which left just-inserted events unclaimable for
    // a few hundred milliseconds and made the suite flaky. One clock
    // decides.
    const claimed = await tx.execute(sql`
      select id, household_id, event_type, payload, attempts
      from ${outboxEvents}
      where status = 'PENDING' and next_attempt_at <= now()
      order by created_at
      limit 1
      for update skip locked
    `);

    const rows = (Array.isArray(claimed) ? claimed : ((claimed as { rows?: unknown[] }).rows ?? [])) as Array<
      Record<string, unknown>
    >;
    const row = rows[0];
    if (!row) return false;

    result.claimed += 1;

    const id = row.id as string;
    const householdId = row.household_id as string;
    const eventType = row.event_type as OutboxEventType;
    const payload = row.payload;
    const attempts = Number(row.attempts) + 1;

    const handler = OUTBOX_HANDLERS[eventType];

    try {
      if (!handler) {
        // An unknown event type is a deployment mistake, not a transient
        // fault — retrying it 5 times would just delay the same outcome.
        throw new Error(`No handler registered for outbox event "${eventType}"`);
      }

      await handler(tx, householdId, payload as never);

      await tx
        .update(outboxEvents)
        .set({ status: "PROCESSED", processedAt: now, attempts, lastError: null })
        .where(sql`id = ${id}`);

      result.processed += 1;
      logger.debug({ event: "outbox.processed", outboxEventId: id, eventType }, "processed outbox event");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = attempts >= MAX_ATTEMPTS || !handler;

      await tx
        .update(outboxEvents)
        .set({
          status: giveUp ? "FAILED" : "PENDING",
          attempts,
          lastError: message.slice(0, 1000),
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
        })
        .where(sql`id = ${id}`);

      if (giveUp) {
        result.failed += 1;
        // Error level, with the id: a permanently failed side effect is
        // something a human has to look at, and the row stays for
        // inspection rather than disappearing.
        logger.error({ event: "outbox.failed", outboxEventId: id, eventType, err: message }, "outbox event failed permanently");
      } else {
        result.retrying += 1;
        logger.warn({ event: "outbox.retry", outboxEventId: id, eventType, attempts, err: message }, "outbox event will retry");
      }
    }

    return true;
  });
}

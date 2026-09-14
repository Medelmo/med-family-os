import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";
import { outboxStatusEnum } from "./enums";

/**
 * Transactional outbox (ADR-004, hosted per ADR-013).
 *
 * Rows are written in the same transaction as the domain change that
 * caused them, so an event can never be "sent but not applied" or
 * "applied but never sent". The worker claims them with FOR UPDATE SKIP
 * LOCKED and processes them outside that transaction.
 */
export const outboxEvents = pgTable(
  "outbox_event",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),

    status: outboxStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    /** When the worker may next try; moves out on each backoff. */
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outbox_event_claim_idx").on(table.status, table.nextAttemptAt)]
);

/**
 * In-app notification — the first, and so far only, delivery channel
 * (CLAUDE.md §16). Deliberately not "Task updated": a notification stores
 * the context and the link needed to act, so the recipient can decide
 * without opening the app and hunting.
 *
 * dedupeKey is unique per household so a retried outbox event, or two
 * events that mean the same thing, cannot produce two notifications —
 * this is what makes the worker's at-least-once delivery safe.
 */
export const notifications = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** Recipient. Notifications are per-account, never household-wide. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_user_unread_idx").on(table.userId, table.readAt),
    // Unique, not merely indexed: this constraint is what makes the
    // worker's at-least-once delivery safe to retry, so the database has
    // to enforce it rather than the handler remembering to check.
    uniqueIndex("notification_dedupe_uq").on(table.householdId, table.dedupeKey),
  ]
);

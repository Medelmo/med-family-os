import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";
import { inboxItemStatusEnum, sensitivityEnum, visibilityEnum } from "./enums";

/**
 * A capture, before anyone has decided what it is.
 *
 * docs/requirements/product-spec.md journey 1: "User records something
 * quickly without deciding its final structure." That is a real domain
 * concept, not a UI card — it has its own lifecycle (captured -> triaged
 * or discarded) and its own provenance (what it became), neither of which
 * belongs on the Task it might turn into. CLAUDE.md §4.1 lists the
 * classification targets: task, case, event, document reference, note,
 * expense, trip item, discard.
 *
 * Phase 2 implements the task and discard routes; the remaining targets
 * arrive with the aggregates they point at, which is why triagedIntoType
 * is a plain string rather than an enum that would need a migration per
 * phase.
 */
export const inboxItems = pgTable(
  "inbox_item",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    capturedText: text("captured_text").notNull(),
    status: inboxItemStatusEnum("status").notNull().default("UNTRIAGED"),

    // Provenance: what this capture became, so a triaged item can still
    // explain itself rather than silently vanishing.
    triagedIntoType: text("triaged_into_type"),
    triagedIntoId: uuid("triaged_into_id"),
    triagedAt: timestamp("triaged_at", { mode: "date", withTimezone: true }),
    discardReason: text("discard_reason"),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    capturedBy: uuid("captured_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("inbox_item_household_status_idx").on(table.householdId, table.status)]
);

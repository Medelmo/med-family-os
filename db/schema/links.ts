import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";
import { linkableTypeEnum } from "./enums";

/**
 * A link between two household records — see domain/links/recordLink.ts
 * for why this is one generic table rather than a join table per pair.
 *
 * The two ends are stored in canonical order, so "document linked to case"
 * and "case linked to document" are the same row and the unique index can
 * actually prevent duplicates.
 *
 * There is no foreign key on either end, because a generic id cannot
 * reference seven tables at once. The consequence is handled on read
 * rather than pretended away: links are resolved by looking each end up in
 * its own table, and an end that no longer exists simply does not come
 * back — a dangling link disappears instead of rendering as a broken
 * entry. `householdId` is a real foreign key, so a deleted household still
 * takes its links with it.
 */
export const recordLinks = pgTable(
  "record_link",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    sourceType: linkableTypeEnum("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetType: linkableTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** The household's own words about *why* these two are related. */
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("record_link_pair_uq").on(
      table.householdId,
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId
    ),
    // Both directions are indexed because a lookup asks "what is linked to
    // this?" without knowing which column the record landed in.
    index("record_link_source_idx").on(table.householdId, table.sourceType, table.sourceId),
    index("record_link_target_idx").on(table.householdId, table.targetType, table.targetId),
    // The domain refuses a self-link; this makes it impossible for any
    // other path to write one.
    check(
      "record_link_not_self",
      sql`not (${table.sourceType} = ${table.targetType} and ${table.sourceId} = ${table.targetId})`
    ),
    // Canonical order, enforced. Without it a caller could insert the
    // mirror row and defeat the unique index above.
    check(
      "record_link_canonical_order",
      sql`(${table.sourceType}, ${table.sourceId}) <= (${table.targetType}, ${table.targetId})`
    ),
  ]
);

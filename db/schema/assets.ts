import { bigint, check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { people } from "./person";
import { users } from "./auth";
import { assetCategoryEnum, sensitivityEnum, visibilityEnum } from "./enums";

const money = (name: string) => bigint(name, { mode: "number" });

/**
 * docs/domain/domain-model.md: "A durable household object."
 *
 * There is no status column. See domain/assets/asset.ts for why: an asset
 * is not a process, and a lifecycle nobody transitions deliberately is a
 * lifecycle that drifts out of date. `disposed_on` records the only
 * transition there is.
 *
 * Sensitivity defaults to NORMAL here and is *raised to SENSITIVE by the
 * command* for MEDICAL and MOBILITY assets — a wheelchair in the list says
 * something about a household member's health. The column default cannot
 * express "depends on the category", so the rule lives in one place in
 * application code and is tested there.
 */
export const assets = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: assetCategoryEnum("category").notNull().default("OTHER"),
    location: text("location"),
    manufacturer: text("manufacturer"),
    identifier: text("identifier"),
    purchasedOn: date("purchased_on"),
    purchasePriceMinor: money("purchase_price_minor"),
    currency: text("currency"),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    notes: text("notes"),

    disposedOn: date("disposed_on"),
    disposalNote: text("disposal_note"),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("asset_household_category_idx").on(table.householdId, table.category),
    check("asset_currency_iso", sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "asset_price_non_negative",
      sql`${table.purchasePriceMinor} is null or ${table.purchasePriceMinor} >= 0`
    ),
  ]
);

/** docs/domain/domain-model.md: "Coverage interval associated with an asset." */
export const warranties = pgTable(
  "warranty",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    /** Their claim or policy number — cover nobody can invoke is not cover. */
    reference: text("reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("warranty_household_ends_idx").on(table.householdId, table.endsOn),
    index("warranty_asset_idx").on(table.assetId),
    check("warranty_dates_ordered", sql`${table.endsOn} >= ${table.startsOn}`),
  ]
);

/**
 * What was done to an asset, and when it is next due.
 *
 * Append-only, like the case and claim timelines and for the same reason:
 * a service history that can be edited afterwards cannot be relied on, and
 * relying on it — "when was the boiler last serviced?" — is the whole
 * point. There is no update or delete path in application code.
 */
export const maintenanceRecords = pgTable(
  "maintenance_record",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    performedOn: date("performed_on").notNull(),
    summary: text("summary").notNull(),
    performedBy: text("performed_by"),
    costMinor: money("cost_minor"),
    currency: text("currency"),
    nextDueOn: date("next_due_on"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("maintenance_asset_performed_idx").on(table.assetId, table.performedOn),
    index("maintenance_household_next_due_idx").on(table.householdId, table.nextDueOn),
    check(
      "maintenance_next_due_after_performed",
      sql`${table.nextDueOn} is null or ${table.nextDueOn} >= ${table.performedOn}`
    ),
    check("maintenance_currency_iso", sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`),
  ]
);

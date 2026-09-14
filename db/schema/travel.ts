import { boolean, check, date, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { people } from "./person";
import { users } from "./auth";
import { sensitivityEnum, tripItemKindEnum, tripStatusEnum, verificationStatusEnum, visibilityEnum } from "./enums";
import { tsvector } from "./search";

/**
 * docs/domain/domain-model.md: "A bounded travel context."
 *
 * Note what is *not* stored: whether the trip is upcoming, happening or
 * over. That is a fact about today's date and these two columns, and
 * keeping a second copy of it would need a job to maintain, could
 * disagree with the dates, and would be wrong for any household whose
 * instance was switched off over the weekend (ADR-016).
 */
export const trips = pgTable(
  "trip",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    destination: text("destination"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: tripStatusEnum("status").notNull().default("PLANNED"),
    notes: text("notes"),

    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    cancelReason: text("cancel_reason"),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    /** Generated and indexed by PostgreSQL; never read into JavaScript (ADR-022). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(destination, '') || ' ' || coalesce(notes, ''))`
    ),
  },
  (table) => [
    index("trip_search_idx").using("gin", table.searchVector),
    index("trip_household_starts_idx").on(table.householdId, table.startsOn),
    index("trip_household_status_idx").on(table.householdId, table.status),
    // A trip that ends before it starts is not a trip. The domain refuses
    // it too; this makes it impossible for any future path — an import, a
    // migration, a hand-run UPDATE — to write one.
    check("trip_dates_ordered", sql`${table.endsOn} >= ${table.startsOn}`),
  ]
);

/** Who is going (ERD: TRIP ||--o{ TRIP_PARTICIPANT }o--|| PERSON). */
export const tripParticipants = pgTable(
  "trip_participant",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.personId] })]
);

/**
 * Itinerary entries, packing lines and access requirements in one table.
 *
 * See domain/travel/tripItem.ts for why they share an aggregate: they all
 * answer "is this trip ready?", and three tables would mean three chances
 * for that answer to disagree with itself.
 */
export const tripItems = pgTable(
  "trip_item",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    kind: tripItemKindEnum("kind").notNull(),
    title: text("title").notNull(),
    /** ITINERARY only. */
    onDate: date("on_date"),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    done: boolean("done").notNull().default(false),

    verification: verificationStatusEnum("verification").notNull().default("UNVERIFIED"),
    /** Who said so, and how — the fact is worth nothing without it. */
    verificationSource: text("verification_source"),
    verifiedOn: date("verified_on"),

    notes: text("notes"),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("trip_item_trip_kind_idx").on(table.tripId, table.kind),
    // An answer with no source is the thing this feature exists to
    // prevent, so the database refuses it rather than trusting every
    // write path to remember.
    check(
      "trip_item_verification_has_source",
      sql`${table.verification} = 'UNVERIFIED' or ${table.verificationSource} is not null`
    ),
  ]
);

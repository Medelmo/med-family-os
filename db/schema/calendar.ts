import { boolean, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { people } from "./person";
import { users } from "./auth";
import { sensitivityEnum, visibilityEnum } from "./enums";

/**
 * docs/domain/domain-model.md: "A scheduled occurrence, distinct from a
 * deadline."
 *
 * The start is stored as **wall-clock parts plus an IANA timezone**, not
 * as a UTC instant. That is the whole point of ADR-014: "Tuesdays at
 * 17:00" is a statement about the clock on the wall, and a stored instant
 * drifts an hour across a DST boundary. The instants are derived on read.
 *
 * `startsAtUtc` is kept alongside as a *derived* column purely so the
 * database can order and range-filter without expanding recurrences.
 * For a recurring event it is the first occurrence only — never treat it
 * as the answer to "when does this happen".
 */
export const calendarEvents = pgTable(
  "calendar_event",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),

    // Wall-clock definition (ADR-014).
    startYear: integer("start_year").notNull(),
    startMonth: smallint("start_month").notNull(),
    startDay: smallint("start_day").notNull(),
    startHour: smallint("start_hour").notNull(),
    startMinute: smallint("start_minute").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    allDay: boolean("all_day").notNull().default(false),
    /** IANA zone. Defaults to the household's, but can differ per event. */
    timeZone: text("time_zone").notNull(),

    /** RecurrenceRule from domain/calendar/recurrence.ts, or null. */
    recurrence: jsonb("recurrence"),

    /**
     * First occurrence as an instant — derived, for ordering and coarse
     * range filters only. Recurrence expansion is authoritative.
     */
    startsAtUtc: timestamp("starts_at_utc", { mode: "date", withTimezone: true }).notNull(),
    /** Last occurrence, where the rule is bounded; null means open-ended. */
    endsAtUtc: timestamp("ends_at_utc", { mode: "date", withTimezone: true }),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("calendar_event_household_start_idx").on(table.householdId, table.startsAtUtc)]
);

/** Who the event concerns — feeds personScopeIds authorization. */
export const calendarEventPeople = pgTable(
  "calendar_event_person",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.personId] })]
);

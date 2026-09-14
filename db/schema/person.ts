import { date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";
import { sensitivityEnum, visibilityEnum } from "./enums";

// docs/domain/domain-model.md: "Person: a real human in or associated with
// the household. A person is not necessarily a login." accountUserId is
// therefore nullable — a young child or a non-login family member can exist
// as a Person with no corresponding UserAccount.
export const people = pgTable("person", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountUserId: uuid("account_user_id").references(() => users.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  dateOfBirth: date("date_of_birth", { mode: "date" }),
  // Cross-cutting fields per docs/domain/domain-model.md "Cross-cutting
  // fields". Defaults to NORMAL, not SENSITIVE: a person's core identity
  // (display name, date of birth) must be visible household-wide,
  // including to a CHILD viewing their own profile or assigned tasks — see
  // the "Person sensitivity" note added to docs/domain/domain-model.md for
  // why this is NORMAL while genuinely sensitive content *about* a person
  // (case details, documents, notes) lives on the aggregate that carries
  // it, classified independently.
  visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
  sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
  // Optimistic-concurrency version (docs/domain/erd.md, CLAUDE.md §8).
  version: integer("version").notNull().default(1),
});

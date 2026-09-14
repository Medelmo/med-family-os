import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { roleEnum, membershipStatusEnum } from "./enums";

export const households = pgTable("household", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

// UserAccount + Household + role + status + scope, per
// docs/domain/domain-model.md ("HouseholdMembership"). One row per
// (user, household) pair — a user could in principle belong to more than
// one household (e.g. a helper account), even though v1 UX only surfaces
// one.
export const householdMemberships = pgTable(
  "household_membership",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("household_membership_household_user_uq").on(table.householdId, table.userId)]
);

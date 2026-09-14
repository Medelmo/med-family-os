import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { tasks } from "./task";
import { users } from "./auth";
import { sensitivityEnum, visibilityEnum } from "./enums";

/**
 * docs/domain/domain-model.md: "A commitment or due point. A deadline may
 * be linked to a case/task/trip/etc."
 *
 * Deliberately not merged into task.dueOn: a deadline is a date the
 * household is committed to whether or not anyone has created work for it
 * (a passport expiring, a filing date). Collapsing the two would mean
 * every real commitment had to be phrased as a task before it could be
 * tracked, which is how commitments get missed.
 *
 * taskId is the only link Phase 2 can offer; case/trip links arrive with
 * those aggregates in Phases 3 and 6.
 */
export const deadlines = pgTable(
  "deadline",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueOn: date("due_on", { mode: "date" }).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    metAt: timestamp("met_at", { mode: "date", withTimezone: true }),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("deadline_household_due_idx").on(table.householdId, table.dueOn)]
);

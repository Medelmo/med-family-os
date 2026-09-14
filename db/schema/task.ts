import { boolean, date, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { people } from "./person";
import { users } from "./auth";
import { priorityEnum, sensitivityEnum, taskStatusEnum, visibilityEnum } from "./enums";
import { tsvector } from "./search";

export const tasks = pgTable(
  "task",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("INBOX"),
    priority: priorityEnum("priority").notNull().default("NORMAL"),

    // Accountability, not authorization (docs/domain/domain-model.md:
    // "Never use ownership as a substitute for authorization").
    ownerPersonId: uuid("owner_person_id").references(() => people.id, { onDelete: "set null" }),

    // A due *date*, not a moment: DATE per docs/domain/erd.md, so it can't
    // drift across a timezone boundary the way a timestamp would.
    dueOn: date("due_on", { mode: "date" }),

    // The next-action / follow-up model docs/requirements/product-spec.md
    // calls the "critical missing concept fixed from original scaffold".
    nextAction: text("next_action"),
    waitingFor: text("waiting_for"),
    waitingSince: timestamp("waiting_since", { mode: "date", withTimezone: true }),
    followUpAt: timestamp("follow_up_at", { mode: "date", withTimezone: true }),
    waitingIndefinite: boolean("waiting_indefinite").notNull().default(false),
    /**
     * Which follow-up moment the reminder scan has already announced.
     * Compared against followUpAt rather than being a plain boolean, so
     * pushing the follow-up date later automatically re-arms the reminder
     * without anyone having to remember to clear a flag.
     */
    followUpNotifiedAt: timestamp("follow_up_notified_at", { mode: "date", withTimezone: true }),

    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    cancelReason: text("cancel_reason"),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
    version: integer("version").notNull().default(1),
    /** Generated and indexed by PostgreSQL; never read into JavaScript (ADR-022). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(next_action, '') || ' ' || coalesce(waiting_for, ''))`
    ),
  },
  (table) => [
    index("task_search_idx").using("gin", table.searchVector),
    // The access patterns that actually exist: every list view is scoped to
    // one household and filtered by status, and Today/Attention sort by due
    // date (docs/domain/erd.md: "indexes on householdId + lifecycle/date
    // fields").
    index("task_household_status_idx").on(table.householdId, table.status),
    index("task_household_due_idx").on(table.householdId, table.dueOn),
    index("task_household_follow_up_idx").on(table.householdId, table.followUpAt),
  ]
);

/**
 * Which people a task is *about* — distinct from who owns it. This is what
 * feeds `personScopeIds` in application/policies/authorize.ts, so a task
 * concerning one child is not visible to another by default.
 */
export const taskPeople = pgTable(
  "task_person",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.personId] })]
);

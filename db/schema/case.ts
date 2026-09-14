import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { people } from "./person";
import { tasks } from "./task";
import { users } from "./auth";
import { caseStatusEnum, priorityEnum, sensitivityEnum, visibilityEnum } from "./enums";

/**
 * docs/domain/domain-model.md: "A real-world process with a lifecycle,
 * participants, next action and timeline."
 *
 * `case` is a SQL reserved word, so the table is named `household_case`.
 * The TypeScript export stays `cases` because the domain word is "case" —
 * the rename is a database-level accommodation, not a domain concept.
 */
export const cases = pgTable(
  "household_case",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: caseStatusEnum("status").notNull().default("DRAFT"),
    priority: priorityEnum("priority").notNull().default("NORMAL"),
    ownerPersonId: uuid("owner_person_id").references(() => people.id, { onDelete: "set null" }),
    nextAction: text("next_action"),

    waitingFor: text("waiting_for"),
    waitingSince: timestamp("waiting_since", { mode: "date", withTimezone: true }),
    followUpAt: timestamp("follow_up_at", { mode: "date", withTimezone: true }),
    waitingNoFollowUpReason: text("waiting_no_follow_up_reason"),
    /** See the same field on db/schema/task.ts. */
    followUpNotifiedAt: timestamp("follow_up_notified_at", { mode: "date", withTimezone: true }),
    /** An authority's file number and the like, so a wait can be chased. */
    externalReference: text("external_reference"),

    blockedReason: text("blocked_reason"),

    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    cancelReason: text("cancel_reason"),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("NORMAL"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("case_household_status_idx").on(table.householdId, table.status),
    index("case_household_follow_up_idx").on(table.householdId, table.followUpAt),
  ]
);

/** Who the case is *about* — feeds personScopeIds authorization. */
export const casePeople = pgTable(
  "case_person",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.personId] })]
);

/**
 * Tasks belonging to a case (ERD: CASE ||--o{ CASE_TASK }o--|| TASK).
 * A link table rather than a caseId column on task, because the ERD models
 * it as many-to-many and because a task can legitimately exist with no
 * case at all — most do.
 */
export const caseTasks = pgTable(
  "case_task",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.caseId, table.taskId] })]
);

/**
 * The case timeline: append-only, like audit_event and for the same
 * reason — "what happened on this case, and when" loses all its value the
 * moment it can be edited after the fact. There is deliberately no update
 * or delete path in application code.
 *
 * This also carries human notes (type NOTE). docs/domain/domain-model.md
 * lists Note as its own aggregate, which it remains for notes that belong
 * to nothing in particular; a note *about a case* is a timeline entry, and
 * splitting it into a second table would mean rendering the timeline from
 * two sources that could disagree about ordering.
 */
export const caseEvents = pgTable(
  "case_event",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** STATUS_CHANGED | NOTE | NEXT_ACTION_SET | TASK_LINKED | CREATED */
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("case_event_case_created_idx").on(table.caseId, table.createdAt)]
);

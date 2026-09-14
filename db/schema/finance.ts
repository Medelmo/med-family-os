import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { people } from "./person";
import { users } from "./auth";
import { expenseCategoryEnum, reimbursementStatusEnum, sensitivityEnum, visibilityEnum } from "./enums";
import { tsvector } from "./search";

/**
 * Money is stored as integer minor units in a `bigint`, never as a float
 * and never as `numeric` read back into a JS number.
 *
 * `bigint` rather than `integer` costs nothing here and removes a ceiling
 * that `integer` would place at about 21 million euros — low enough that a
 * currency with small units, or a mis-parsed CSV row, could overflow it and
 * corrupt a record instead of failing. Drizzle's `mode: "number"` keeps it
 * an ordinary JS number, which is exact to 2^53 minor units.
 *
 * The currency is stored per row rather than only on the household: a
 * receipt from a trip stays in the currency it was paid in, and a later
 * change to the household's default must not silently restate history.
 */
const money = (name: string) => bigint(name, { mode: "number" });

export const expenses = pgTable(
  "expense",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    category: expenseCategoryEnum("category").notNull().default("OTHER"),
    currency: text("currency").notNull(),
    amountMinor: money("amount_minor").notNull(),
    /** A date, not an instant: an expense happens on a day (CLAUDE.md §7). */
    incurredOn: date("incurred_on").notNull(),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    paidByPersonId: uuid("paid_by_person_id").references(() => people.id, { onDelete: "set null" }),
    merchant: text("merchant"),
    notes: text("notes"),
    /**
     * Set when the expense is part of a claim. `set null` rather than
     * cascade: deleting a claim must never delete the household's record
     * that the money was spent.
     */
    reimbursementId: uuid("reimbursement_id").references((): AnyPgColumn => reimbursements.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),

    // Defaults to SENSITIVE — see DEFAULT_EXPENSE_SENSITIVITY in
    // domain/finance/expense.ts for why this one aggregate differs.
    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("SENSITIVE"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    /** Generated and indexed by PostgreSQL; never read into JavaScript (ADR-022). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(description, '') || ' ' || coalesce(merchant, '') || ' ' || coalesce(notes, ''))`
    ),
  },
  (table) => [
    index("expense_search_idx").using("gin", table.searchVector),
    index("expense_household_incurred_idx").on(table.householdId, table.incurredOn),
    index("expense_household_category_idx").on(table.householdId, table.category),
    index("expense_reimbursement_idx").on(table.reimbursementId),
    // Currency codes are compared and grouped on; a lowercase row would
    // silently split a total in two.
    check("expense_currency_iso", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ]
);

export const reimbursements = pgTable(
  "reimbursement",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: reimbursementStatusEnum("status").notNull().default("PLANNED"),
    counterparty: text("counterparty"),
    externalReference: text("external_reference"),

    currency: text("currency").notNull(),
    claimedAmountMinor: money("claimed_amount_minor").notNull().default(0),
    approvedAmountMinor: money("approved_amount_minor"),
    reimbursedAmountMinor: money("reimbursed_amount_minor").notNull().default(0),

    submittedAt: timestamp("submitted_at", { mode: "date", withTimezone: true }),
    waitingSince: timestamp("waiting_since", { mode: "date", withTimezone: true }),
    followUpAt: timestamp("follow_up_at", { mode: "date", withTimezone: true }),
    waitingNoFollowUpReason: text("waiting_no_follow_up_reason"),
    /** See the same field on db/schema/task.ts — lets a moved date re-arm the reminder scan. */
    followUpNotifiedAt: timestamp("follow_up_notified_at", { mode: "date", withTimezone: true }),

    decidedAt: timestamp("decided_at", { mode: "date", withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    paidAt: timestamp("paid_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    cancelReason: text("cancel_reason"),

    notes: text("notes"),

    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    sensitivity: sensitivityEnum("sensitivity").notNull().default("SENSITIVE"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
    /** Generated and indexed by PostgreSQL; never read into JavaScript (ADR-022). */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(counterparty, '') || ' ' || coalesce(external_reference, ''))`
    ),
  },
  (table) => [
    index("reimbursement_search_idx").using("gin", table.searchVector),
    index("reimbursement_household_status_idx").on(table.householdId, table.status),
    index("reimbursement_household_follow_up_idx").on(table.householdId, table.followUpAt),
    check("reimbursement_currency_iso", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // Amounts are never negative. The state machine already refuses them,
    // but a constraint here means no future code path — an import, a
    // migration, a hand-run UPDATE — can put the household's books into a
    // state the domain considers impossible.
    check(
      "reimbursement_amounts_non_negative",
      sql`${table.claimedAmountMinor} >= 0 and ${table.reimbursedAmountMinor} >= 0 and (${table.approvedAmountMinor} is null or ${table.approvedAmountMinor} >= 0)`
    ),
  ]
);

/**
 * The claim's timeline, append-only for the same reason as `case_event`:
 * "what happened on this claim, and when" is worthless if it can be edited
 * afterwards. There is deliberately no update or delete path in
 * application code.
 */
export const reimbursementEvents = pgTable(
  "reimbursement_event",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    reimbursementId: uuid("reimbursement_id")
      .notNull()
      .references(() => reimbursements.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** STATUS_CHANGED | NOTE | EXPENSE_LINKED | EXPENSE_UNLINKED | CREATED */
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("reimbursement_event_claim_created_idx").on(table.reimbursementId, table.createdAt)]
);

/**
 * A recurring monthly envelope per category — see domain/finance/budget.ts
 * for why this is not one row per month.
 */
export const budgets = pgTable(
  "budget",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    category: expenseCategoryEnum("category").notNull(),
    currency: text("currency").notNull(),
    monthlyLimitMinor: money("monthly_limit_minor").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    // One *open* envelope per category and currency. Overlapping envelopes
    // would make "the limit for March" ambiguous, and the projection has no
    // principled way to choose between them.
    uniqueIndex("budget_household_category_currency_open_uq")
      .on(table.householdId, table.category, table.currency)
      .where(sql`${table.endsOn} is null`),
    check("budget_currency_iso", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("budget_limit_positive", sql`${table.monthlyLimitMinor} > 0`),
    check("budget_period_ordered", sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`),
  ]
);

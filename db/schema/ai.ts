import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";
import { aiSuggestionKindEnum, aiSuggestionStatusEnum } from "./enums";

/**
 * Something a model proposed, and what a person did about it (ADR-027).
 *
 * The row exists to make CLAUDE.md §11's "visible provenance" real. A task
 * that a model suggested and somebody accepted six months ago is,
 * afterwards, an ordinary task — and the only way to answer "where did
 * this come from?" is a record that says so, kept whatever the answer was.
 *
 * So nothing here is deleted. A rejected suggestion is retained because
 * *what a household declined* is as much a part of the trail as what they
 * took, and a model that keeps proposing something they keep refusing is
 * a fact worth being able to see.
 *
 * The suggestion carries no `visibility` or `sensitivity` of its own. It
 * is not a record about the household; it is a record about a proposal,
 * and it may only ever have been built from material the actor could
 * already read (domain/ai/disclosure.ts).
 */
export const aiSuggestions = pgTable(
  "ai_suggestion",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),

    kind: aiSuggestionKindEnum("kind").notNull(),
    status: aiSuggestionStatusEnum("status").notNull().default("PROPOSED"),

    /** What was proposed, shaped for the command that would accept it. */
    payload: jsonb("payload").notNull(),

    /**
     * Where it came from: model, locality, prompt version, the records it
     * was shown with their versions, what was withheld, what was scrubbed.
     * One column because it is read and written whole and never queried
     * into — the shape is `Provenance` in domain/ai/suggestion.ts.
     */
    provenance: jsonb("provenance").notNull(),

    /** Who decided, and when. Null while PROPOSED. */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { mode: "date", withTimezone: true }),

    /**
     * What accepting it created. Not a foreign key: like `record_link`, a
     * generic id cannot reference seven tables — and the same trade
     * applies, a dangling pointer simply resolves to nothing.
     */
    resultType: text("result_type"),
    resultId: uuid("result_id"),

    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The only access pattern: "what is waiting for me in this household",
    // newest first.
    index("ai_suggestion_household_status_idx").on(table.householdId, table.status, table.createdAt),
    // And the reverse lookup that makes provenance answerable from the
    // record rather than only from the suggestion.
    index("ai_suggestion_result_idx").on(table.resultType, table.resultId),
  ]
);

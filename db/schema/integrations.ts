import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";
import {
  documentProviderEnum,
  integrationProviderEnum,
  sensitivityEnum,
  syncRunStatusEnum,
  visibilityEnum,
} from "./enums";

/**
 * A configured connection to an external system.
 *
 * No status enum: a connection is enabled or disabled by a person, which
 * is a boolean, not a lifecycle (the test from ADR-017 — does a human ever
 * have to decide which state it should be in next?). Health is reported by
 * the sync runs, which have their own machine.
 *
 * The credential is not here. It lives in `integration_credential`, which
 * this table joins to nothing — CLAUDE.md §7's "never store long-lived
 * external secrets in ordinary domain tables", taken literally (ADR-019).
 */
export const integrationConnections = pgTable(
  "integration_connection",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull(),
    enabled: boolean("enabled").notNull().default(true),

    /** Where the last successful or partial run reached. */
    cursor: text("cursor"),
    lastSyncAt: timestamp("last_sync_at", { mode: "date", withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { mode: "date", withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("integration_connection_household_idx").on(table.householdId, table.provider),
    // A base URL that is not http(s) would be rendered as a link and used
    // as a fetch target; the domain refuses one too, and this makes it
    // impossible for any other path to write one.
    check("integration_connection_base_url_scheme", sql`${table.baseUrl} ~* '^https?://'`),
  ]
);

/**
 * One sealed external secret.
 *
 * Deliberately its own table holding nothing but ciphertext and the id of
 * the key that sealed it. No domain query selects from it; the only reader
 * is the adapter that is about to authenticate.
 *
 * `key_id` is stored separately from the sealed value as well as inside
 * it, so a rotation pass can find the rows that still need re-sealing with
 * an index rather than by opening every credential it owns.
 */
export const integrationCredentials = pgTable(
  "integration_credential",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    /** What the secret is for — "api_token", "app_password". Part of the AEAD context. */
    purpose: text("purpose").notNull(),
    keyId: text("key_id").notNull(),
    /** `keyId.iv.tag.ciphertext`, base64url (ADR-019). */
    sealed: text("sealed").notNull(),
    rotatedAt: timestamp("rotated_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_credential_connection_purpose_uq").on(table.connectionId, table.purpose),
    index("integration_credential_key_idx").on(table.keyId),
  ]
);

/** One synchronisation attempt — the machine lives in domain/integrations/syncRun.ts. */
export const syncRuns = pgTable(
  "sync_run",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    status: syncRunStatusEnum("status").notNull().default("PENDING"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    itemsSeen: integer("items_seen").notNull().default(0),
    itemsImported: integer("items_imported").notNull().default(0),
    itemsSkipped: integer("items_skipped").notNull().default(0),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    /** Classified kind, and a message that never contains the credential. */
    errorKind: text("error_kind"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sync_run_connection_created_idx").on(table.connectionId, table.createdAt)]
);

/**
 * A pointer to a document that lives somewhere else.
 *
 * `title` is the provider's and a sync overwrites it; `title_override` and
 * `note` are the household's and a sync cannot reach them. Keeping them in
 * separate columns is how "a sync run must never silently overwrite local
 * edits" is enforced structurally rather than by a dirty flag somebody has
 * to remember to set (domain/documents/documentReference.ts).
 */
export const documentReferences = pgTable(
  "document_reference",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    provider: documentProviderEnum("provider").notNull().default("MANUAL"),
    externalId: text("external_id"),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),

    title: text("title").notNull(),
    titleOverride: text("title_override"),
    documentDate: date("document_date"),
    url: text("url"),
    note: text("note"),

    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
    visibility: visibilityEnum("visibility").notNull().default("HOUSEHOLD"),
    // A household's documents are its administrative and medical paperwork
    // by default, so this follows expenses rather than tasks (ADR-015 §4).
    sensitivity: sensitivityEnum("sensitivity").notNull().default("SENSITIVE"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    // Idempotency for a re-run: the same provider document never lands
    // twice, whatever a sync does. This is the constraint that lets the
    // importer be a plain upsert instead of a check-then-insert race.
    uniqueIndex("document_reference_provider_external_uq")
      .on(table.householdId, table.provider, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index("document_reference_household_date_idx").on(table.householdId, table.documentDate),
    check("document_reference_url_scheme", sql`${table.url} is null or ${table.url} ~* '^https?://'`),
  ]
);

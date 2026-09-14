import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { households } from "./household";
import { users } from "./auth";

// docs/domain/domain-model.md: "AuditEvent: Immutable security/operational
// record." No updatedAt/version — audit rows are append-only and are never
// updated in place. No archivedAt either: docs/domain/erd.md forbids
// cascade delete across audit history, and there is deliberately no delete
// path for this table in application code (see docs/security/privacy-and-retention.md:
// "Audit records: retained longer than operational records; deletion
// requires a documented policy").
//
// actorUserId is nullable to allow system-initiated events (e.g. a future
// scheduled job) that have no human actor; it references users with
// onDelete "set null" rather than "cascade" so deleting an account does not
// delete the historical record of what that account did.
export const auditEvents = pgTable("audit_event", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id"),
  // Non-sensitive metadata only (ADR-010 / security-model.md: never log
  // secrets or sensitive personal content unnecessarily). Application code
  // is responsible for keeping this field free of SENSITIVE/HIGHLY_SENSITIVE
  // values — see application/audit/recordAuditEvent.ts.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

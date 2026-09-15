import { pgEnum } from "drizzle-orm/pg-core";

// Mirrors domain/shared/types.ts. Keep both in sync by hand — Drizzle enums
// and TypeScript union types are not generated from one another here.
export const roleEnum = pgEnum("role", ["OWNER", "ADMIN", "ADULT", "CHILD", "VIEWER"]);
export const visibilityEnum = pgEnum("visibility", ["PRIVATE", "HOUSEHOLD", "SHARED"]);
export const sensitivityEnum = pgEnum("sensitivity", ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"]);
export const membershipStatusEnum = pgEnum("membership_status", ["ACTIVE", "SUSPENDED", "REMOVED"]);
export const priorityEnum = pgEnum("priority", ["LOW", "NORMAL", "HIGH", "CRITICAL"]);

// Mirrors domain/tasks/task.ts. The database stores the state; the legal
// transitions between states live in that module and are enforced in
// application commands (docs/domain/erd.md: "state transitions are enforced
// in application commands and tested") — a CHECK constraint cannot express
// "which previous states were allowed".
export const taskStatusEnum = pgEnum("task_status", [
  "INBOX",
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "COMPLETED",
  "CANCELLED",
]);

export const inboxItemStatusEnum = pgEnum("inbox_item_status", ["UNTRIAGED", "TRIAGED", "DISCARDED"]);

// FAILED is terminal: the worker stops retrying and leaves the row for
// inspection rather than looping forever (ADR-013).
export const outboxStatusEnum = pgEnum("outbox_status", ["PENDING", "PROCESSED", "FAILED"]);

// Mirrors LINKABLE_TYPES in domain/links/recordLink.ts. Note the enum
// ordering is also the canonical ordering links are stored in, so adding
// a value at the end never re-sorts existing rows.
export const linkableTypeEnum = pgEnum("linkable_type", [
  "case",
  "task",
  "expense",
  "reimbursement",
  "trip",
  "asset",
  "document",
]);

// Mirrors domain/integrations/syncRun.ts. PARTIAL is the interesting one:
// a run that imported eleven documents and choked on the twelfth has done
// real work and has also not finished.
export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "RETRYING",
]);

// Which external systems a connection can be configured for. Kept
// separate from document_provider: a connection can exist for a system
// that does not produce document references.
export const integrationProviderEnum = pgEnum("integration_provider", ["PAPERLESS", "NEXTCLOUD", "CALDAV"]);

// Mirrors DOCUMENT_PROVIDERS in domain/documents/documentReference.ts.
// MANUAL is a reference somebody typed in, with no connection behind it.
export const documentProviderEnum = pgEnum("document_provider", ["PAPERLESS", "NEXTCLOUD", "MANUAL"]);

// Mirrors ASSET_CATEGORIES in domain/assets/asset.ts. MEDICAL and
// MOBILITY are not just labels: the command raises those assets to
// SENSITIVE, because a wheelchair in the list says something about a
// household member's health (ADR-017).
export const assetCategoryEnum = pgEnum("asset_category", [
  "APPLIANCE",
  "ELECTRONICS",
  "FURNITURE",
  "MOBILITY",
  "MEDICAL",
  "VEHICLE",
  "TOOL",
  "OTHER",
]);

// Mirrors domain/travel/trip.ts. There is deliberately no IN_PROGRESS or
// COMPLETED: whether a trip is upcoming, happening or over is derived from
// its dates, never stored (ADR-016).
export const tripStatusEnum = pgEnum("trip_status", ["PLANNED", "CONFIRMED", "CANCELLED", "ARCHIVED"]);

// Mirrors TRIP_ITEM_KINDS in domain/travel/tripItem.ts.
export const tripItemKindEnum = pgEnum("trip_item_kind", ["ITINERARY", "PACKING", "ACCESSIBILITY"]);

// Mirrors VERIFICATION_STATUSES. REFUSED is an answer, not an unfinished
// question: knowing the hotel has no lift is actionable information.
export const verificationStatusEnum = pgEnum("verification_status", ["UNVERIFIED", "CONFIRMED", "REFUSED"]);

// Mirrors domain/finance/reimbursement.ts. WAITING -> REJECTED is a
// deliberate addition to docs/domain/state-machines.md rather than a
// divergence from it; see ADR-015 and the comment on ALLOWED_TRANSITIONS.
export const reimbursementStatusEnum = pgEnum("reimbursement_status", [
  "PLANNED",
  "SUBMITTED",
  "WAITING",
  "APPROVED",
  "PARTIALLY_REIMBURSED",
  "PAID",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
]);

// Mirrors EXPENSE_CATEGORIES in domain/finance/expense.ts.
export const expenseCategoryEnum = pgEnum("expense_category", [
  "HOUSING",
  "UTILITIES",
  "GROCERIES",
  "HEALTH",
  "INSURANCE",
  "TRANSPORT",
  "CHILDCARE",
  "EDUCATION",
  "LEISURE",
  "TRAVEL",
  "HOUSEHOLD",
  "FEES",
  "OTHER",
]);

// Mirrors domain/cases/case.ts. Note this is a different shape from
// task_status on purpose: a case can be BLOCKED and ARCHIVED, a task
// cannot, and a task can be reopened, a case cannot (ADR-007).
export const caseStatusEnum = pgEnum("case_status", [
  "DRAFT",
  "ACTIVE",
  "WAITING",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
]);

/**
 * AI suggestions (ADR-027). `STALE` is not a decision anybody made — it is
 * what happens when the records a suggestion was about change underneath
 * it, which is why it sits alongside the two human answers rather than
 * inside them.
 */
export const aiSuggestionStatusEnum = pgEnum("ai_suggestion_status", [
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "STALE",
]);

export const aiSuggestionKindEnum = pgEnum("ai_suggestion_kind", [
  "CASE_NEXT_ACTION",
  "CASE_TASK",
  "CASE_SUMMARY",
]);

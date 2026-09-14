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

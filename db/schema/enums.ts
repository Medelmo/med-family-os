import { pgEnum } from "drizzle-orm/pg-core";

// Mirrors domain/shared/types.ts. Keep both in sync by hand — Drizzle enums
// and TypeScript union types are not generated from one another here.
export const roleEnum = pgEnum("role", ["OWNER", "ADMIN", "ADULT", "CHILD", "VIEWER"]);
export const visibilityEnum = pgEnum("visibility", ["PRIVATE", "HOUSEHOLD", "SHARED"]);
export const sensitivityEnum = pgEnum("sensitivity", ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"]);
export const membershipStatusEnum = pgEnum("membership_status", ["ACTIVE", "SUSPENDED", "REMOVED"]);

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Authentication identity (domain-model.md: "UserAccount"). Deliberately
// separate from db/schema/person.ts ("Person: a real human... not
// necessarily a login") per docs/domain/domain-model.md. This table is
// Auth.js-adjacent infrastructure, not an ordinary domain aggregate.
//
// passwordHash lives here (not on `person`) because CLAUDE.md rule #7
// forbids storing passwords in ordinary domain tables — this table is the
// auth subsystem's own identity record, matching the "UserAccount" concept
// the domain model already carves out as distinct from Person. See
// docs/architecture/adr/ADR-006-authentication.md.
//
// No Auth.js Adapter is configured (ADR-006 "Correction"): Credentials-only
// forces JWT session strategy, so there is nothing that consumes an
// adapter's accounts/sessions/verificationTokens tables. This table is
// queried directly by infrastructure/auth/auth.ts's authorize() callback.
export const users = pgTable("user", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  // Null only for accounts that will exclusively use a future OAuth
  // provider; ADR-006 currently ships Credentials-only, so this is set for
  // every account created through the app today.
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

// Explicit revocation ledger for JWT sessions (ADR-006 "Correction"). The
// row's id is embedded in the JWT as `sid`; the `jwt` callback in
// infrastructure/auth/auth.ts checks this table on every request and
// invalidates the token if the row is missing or revokedAt is set.
// "Sign out everywhere" is: set revokedAt on every row for a userId.
export const sessionRevocations = pgTable("session_revocation", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  // Non-identifying context for a session-listing UI ("Chrome on Windows",
  // "last used 2 hours ago") — never store raw IP/full UA if avoidable
  // beyond what's needed for that display per security-model.md's
  // redacted-logs principle; a short label is enough.
  userAgentLabel: text("user_agent_label"),
});

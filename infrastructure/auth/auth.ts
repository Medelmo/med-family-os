import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "@auth/core/jwt";
import type { Session } from "next-auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { users, sessionRevocations, householdMemberships, people } from "../../db/schema";
import { verifyPassword } from "./password";
import { consumeAuthAttempt } from "../rate-limit/limiter";
import { logger } from "../logging/logger";
import { authConfig } from "./auth.config";

// Only update the revocation row's lastUsedAt when it's gone stale, so a
// normal browsing session doesn't issue a DB write on every single request
// that touches auth() — the jwt() callback below runs on every request that
// needs the token decoded.
const LAST_USED_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: {
    strategy: "jwt",
    // 12h: short enough that a lost/stolen device's session expires within
    // a working day even if sign-out-everywhere isn't used; long enough not
    // to force daily re-login for a household member checking the app.
    maxAge: 12 * 60 * 60,
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        try {
          await consumeAuthAttempt(email);
        } catch {
          // Rate-limited: fail closed exactly like a wrong password, so the
          // sign-in form can't distinguish "rate limited" from "wrong
          // credentials" (docs/security/threat-model.md — don't leak which
          // failure mode occurred).
          return null;
        }

        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!row?.passwordHash) {
          // Still run a verify against a dummy hash so the response time
          // for "no such user" and "wrong password" doesn't leak which one
          // happened via a timing side channel.
          await verifyPassword(
            "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            password
          );
          return null;
        }

        const valid = await verifyPassword(row.passwordHash, password);
        if (!valid) return null;

        return { id: row.id, name: row.name, email: row.email };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Explicit parameter types below, rather than relying on inference
    // from NextAuth()'s call-site contextual typing: verified empirically
    // that once `callbacks` is built by spreading `...authConfig.callbacks`
    // into a new object literal (needed to keep the Edge-safe `authorized`
    // callback from auth.config.ts alongside these DB-backed ones),
    // TypeScript stops propagating the expected `NextAuthConfig["callbacks"]`
    // type into `jwt`/`session`'s parameters — `token` was inferred as
    // effectively untyped (property access silently typed `{}`) rather than
    // the augmented `JWT` from types/next-auth.d.ts. Annotating directly
    // sidesteps whatever inference gap the spread introduces.
    async jwt({ token, user }: { token: JWT; user?: { id?: string } }) {
      if (user?.id) {
        // Fresh sign-in: mint a new revocable session record.
        const [revocation] = await db.insert(sessionRevocations).values({ userId: user.id }).returning();
        token.sid = revocation.id;
        token.uid = user.id;
        return token;
      }

      if (!token.sid || !token.uid) return null;

      const [revocation] = await db
        .select()
        .from(sessionRevocations)
        .where(eq(sessionRevocations.id, token.sid))
        .limit(1);

      if (!revocation || revocation.revokedAt) {
        logger.info({ event: "auth.session_revoked", sid: token.sid }, "rejected a revoked or unknown session token");
        return null;
      }

      if (Date.now() - revocation.lastUsedAt.getTime() > LAST_USED_TOUCH_INTERVAL_MS) {
        await db
          .update(sessionRevocations)
          .set({ lastUsedAt: new Date() })
          .where(eq(sessionRevocations.id, revocation.id));
      }

      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (!token.uid) return session;
      session.user.id = token.uid;
      session.sid = token.sid;

      // Attach household/role/person-scope so application/policies/authorize.ts
      // has an Actor without a second query in every server component/action.
      // v1 UX supports one household per user (docs/domain/domain-model.md
      // keeps the model generic for multiple; this picks the first ACTIVE
      // membership as a documented v1 simplification).
      const [membership] = await db
        .select({ householdId: householdMemberships.householdId, role: householdMemberships.role })
        .from(householdMemberships)
        .where(and(eq(householdMemberships.userId, token.uid), eq(householdMemberships.status, "ACTIVE")))
        .limit(1);

      if (membership) {
        session.user.householdId = membership.householdId;
        session.user.role = membership.role;

        const personRows = await db
          .select({ id: people.id })
          .from(people)
          .where(and(eq(people.householdId, membership.householdId), eq(people.accountUserId, token.uid)));
        session.user.personIds = personRows.map((p) => p.id);
      } else {
        session.user.personIds = [];
      }

      return session;
    },
  },
});

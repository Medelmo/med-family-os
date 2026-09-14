import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe subset of the Auth.js config: no database access, no Node-only
 * native modules (@node-rs/argon2, pg). This is the only auth config
 * proxy.ts is allowed to import, since Next.js's proxy convention
 * (formerly "middleware.ts") runs on the Edge runtime.
 *
 * Consequence worth stating explicitly rather than discovering by
 * accident: middleware's `authorized()` check below only verifies the JWT's
 * signature/expiry — it does NOT run the DB-backed revocation check that
 * lives in infrastructure/auth/auth.ts's `jwt` callback (ADR-006), because
 * that callback isn't part of this config. This is a deliberate two-tier
 * design, not an oversight:
 * - middleware = fast, optimistic "looks logged in" redirect for UX.
 * - the full `auth()` from infrastructure/auth/auth.ts, called in every
 *   protected Server Component/Server Action/Route Handler, is what
 *   actually enforces revocation before any data is read or written.
 * A revoked session might not be redirected away from a page shell by
 * middleware immediately, but it cannot read or mutate protected data,
 * because that always goes through the full auth().
 */
export const authConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isPublicRoute =
        request.nextUrl.pathname.startsWith("/login") ||
        request.nextUrl.pathname.startsWith("/setup") ||
        request.nextUrl.pathname.startsWith("/api/health") ||
        request.nextUrl.pathname.startsWith("/api/ready");
      if (isPublicRoute) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;

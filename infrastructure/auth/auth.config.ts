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
  // Auth.js refuses to derive callback/session URLs from the request Host
  // in production unless the host is explicitly trusted — without this,
  // every authenticated route fails with `UntrustedHost` in a production
  // build while working fine under `next dev`, which trusts localhost
  // implicitly. (Found by running the real production build under the E2E
  // suite; `next dev`, typecheck and unit tests all pass with it missing.)
  //
  // Trusting the host is correct *for this deployment model specifically*:
  // docs/architecture/deployment.md puts the app behind a reverse proxy on
  // a private network, publishing only the proxy-facing port, so the Host /
  // X-Forwarded-Host header is set by infrastructure the household
  // controls. The reverse proxy must therefore set Host correctly and not
  // pass an attacker-supplied one through — see docs/security/security-model.md.
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isPublicRoute =
        request.nextUrl.pathname.startsWith("/login") ||
        request.nextUrl.pathname.startsWith("/setup") ||
        request.nextUrl.pathname.startsWith("/api/health") ||
        request.nextUrl.pathname.startsWith("/api/ready") ||
        // The Home Assistant summary authenticates itself with a scoped
        // bearer token (CLAUDE.md §10): the caller is a machine with no
        // session, and redirecting it to a sign-in page would be a 307 and
        // an HTML body where it asked for JSON. "Public" here means only
        // that the session check does not apply — app/api/ha/summary/route.ts
        // refuses every request that does not present the token, and fails
        // closed when no token is configured at all.
        request.nextUrl.pathname.startsWith("/api/ha/");
      if (isPublicRoute) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;

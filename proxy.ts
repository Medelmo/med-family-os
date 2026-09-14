import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./infrastructure/auth/auth.config";

// Edge-runtime proxy (Next.js 16 renamed the "middleware.ts" file
// convention to "proxy.ts" — same file location and default-export
// convention, verified against next@16.3.5's own build source since the
// migration codemod, `npx @next/codemod@canary middleware-to-proxy .`,
// made no changes here itself). See infrastructure/auth/auth.config.ts for
// why the redirect below is an optimistic "looks logged in" check, not the
// authoritative (DB-backed, revocation-checked) auth enforced by every
// protected Server Component/Server Action/Route Handler via the full
// auth() in infrastructure/auth/auth.ts.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isAuthorized = authConfig.callbacks.authorized({ auth: req.auth, request: req });

  if (!isAuthorized) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Correlation ID (docs/security/security-model.md): generated once per
  // request here (Edge-safe crypto.randomUUID(), no Node dependency),
  // forwarded to the app via a request header so Server Components/Route
  // Handlers can read it and build a child logger
  // (infrastructure/logging/logger.ts) without re-deriving an ID.
  const requestId = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const csp = contentSecurityPolicy(nonce);

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-request-id", requestId);
  // Next.js reads the nonce out of the request's own CSP header and stamps
  // it onto the script tags it emits. Without this the policy below would
  // block Next's inline RSC payload scripts and the app would render but
  // never hydrate.
  forwardedHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set("x-request-id", requestId);
  applySecurityHeaders(response.headers, csp);
  return response;
});

/**
 * Nonce-based CSP.
 *
 * A plain `script-src 'self'` looks stricter but silently breaks the app:
 * Next.js App Router emits its RSC payload as inline `self.__next_f.push(...)`
 * scripts, so blocking inline scripts blocks hydration — every client
 * component stops responding while the server-rendered HTML still looks
 * perfectly fine. Found exactly that way: the page rendered, and nothing
 * that needed JavaScript worked.
 *
 * 'strict-dynamic' lets the nonced Next bootstrap load its own chunks
 * without enumerating them, which is the current recommended shape for a
 * strict CSP.
 */
function contentSecurityPolicy(nonce: string): string {
  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];

  // Next's dev server compiles with eval for hot reloading, and pushes
  // updates over a WebSocket that `connect-src 'self'` does not cover.
  // Production gets neither relaxation — it has no HMR to serve.
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    scriptSrc.push(`'unsafe-eval'`);
  }
  const connectSrc = isDev ? `'self' ws: wss:` : `'self'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Styles stay 'unsafe-inline': Next injects inline <style> for CSS
    // Modules, and style injection is not an script-execution vector.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function applySecurityHeaders(headers: Headers, csp: string): void {
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};

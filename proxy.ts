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
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set("x-request-id", requestId);
  applySecurityHeaders(response.headers);
  return response;
});

function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // 'unsafe-inline' on style-src only (not script-src): Next.js App Router
  // doesn't need inline scripts for its own hydration (__NEXT_DATA__ is
  // type="application/json", not executed), but some inline styles are
  // still common. Revisit with nonces if a future integration needs
  // inline script execution.
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};

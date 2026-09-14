import { Pool } from "pg";
import { RateLimiterPostgres, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { logger } from "../logging/logger";

// ADR-009: a dedicated pg.Pool, separate from the Drizzle/postgres.js
// connection in infrastructure/db/client.ts — RateLimiterPostgres speaks
// the node-postgres query interface, not postgres.js's tagged-template
// API. Same physical database, a second small connection pool.
declare global {
  var __medFamilyOsRateLimitPool: Pool | undefined;
}

function getPool(): Pool | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  if (!globalThis.__medFamilyOsRateLimitPool) {
    globalThis.__medFamilyOsRateLimitPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  }
  return globalThis.__medFamilyOsRateLimitPool;
}

// Authentication attempts: 5 per 15 minutes per key (per docs/security/security-model.md
// "rate limiting on authentication and abuse-sensitive endpoints").
const AUTH_POINTS = 5;
const AUTH_DURATION_SECONDS = 15 * 60;

let authLimiter: RateLimiterPostgres | RateLimiterMemory | undefined;

function getAuthLimiter(): RateLimiterPostgres | RateLimiterMemory {
  if (authLimiter) return authLimiter;

  const pool = getPool();
  if (!pool) {
    // No DATABASE_URL (e.g. a unit-test process importing this module
    // indirectly): fall back to an in-memory limiter rather than throwing,
    // since this module is imported by infrastructure/auth/auth.ts which
    // other modules may import transitively without ever calling the
    // limiter.
    authLimiter = new RateLimiterMemory({ points: AUTH_POINTS, duration: AUTH_DURATION_SECONDS });
    return authLimiter;
  }

  authLimiter = new RateLimiterPostgres({
    storeClient: pool,
    storeType: "pg",
    tableName: "rate_limit_auth",
    points: AUTH_POINTS,
    duration: AUTH_DURATION_SECONDS,
    insuranceLimiter: new RateLimiterMemory({ points: AUTH_POINTS, duration: AUTH_DURATION_SECONDS }),
  });
  return authLimiter;
}

export type AuthAttemptOutcome = "allowed" | "rate_limited";

/**
 * Consumes one authentication attempt for `key`.
 *
 * Deliberately distinguishes the two failure modes CLAUDE.md §21 asks to
 * keep apart, because conflating them is a real availability bug: a
 * genuine limit breach must block the attempt, but a *limiter
 * infrastructure* failure (store unreachable, table missing, driver
 * error) must not — otherwise one broken dependency locks an entire
 * household out of their own self-hosted app with no support desk to call.
 *
 * The password check in authorize() remains the primary control; this
 * limiter is defense-in-depth against online guessing, so failing open on
 * an infrastructure error (loudly, at error level) is the safer trade.
 * rate-limiter-flexible signals a real breach by rejecting with a
 * RateLimiterRes and an infrastructure problem by rejecting with an Error.
 */
export async function consumeAuthAttempt(key: string): Promise<AuthAttemptOutcome> {
  try {
    await getAuthLimiter().consume(key, 1);
    return "allowed";
  } catch (rejection) {
    if (rejection instanceof RateLimiterRes) {
      logger.warn({ event: "auth.rate_limited", msBeforeNext: rejection.msBeforeNext }, "sign-in rate limit exceeded");
      return "rate_limited";
    }

    logger.error(
      { event: "auth.rate_limiter_unavailable", err: rejection },
      "rate limiter failed; allowing the attempt to proceed to password verification"
    );
    return "allowed";
  }
}

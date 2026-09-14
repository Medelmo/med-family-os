import { Pool } from "pg";
import { RateLimiterPostgres, RateLimiterMemory } from "rate-limiter-flexible";
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
    // indirectly): fail safe to an in-memory limiter rather than throwing,
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

/**
 * Throws (does not return false) when the limit is exceeded, matching
 * rate-limiter-flexible's own convention — callers must catch, not check a
 * boolean.
 */
export async function consumeAuthAttempt(key: string): Promise<void> {
  try {
    await getAuthLimiter().consume(key, 1);
  } catch (rejection) {
    logger.warn({ event: "auth.rate_limited" }, "sign-in rate limit exceeded");
    throw rejection;
  }
}

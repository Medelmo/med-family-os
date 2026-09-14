import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The scoped read-only credential the Home Assistant summary endpoint
 * accepts (`HA_READONLY_TOKEN`, see .env.example).
 *
 * Three properties, each of which has been a real bug in somebody's code:
 *
 * 1. **Fails closed when unconfigured.** An unset or blank token disables
 *    the endpoint entirely rather than allowing everything or comparing
 *    against `undefined`. A deployment that has not set one has not opted
 *    in to a machine-readable surface, and should not get one by accident.
 *
 * 2. **Constant time.** A naive `===` leaks the token a character at a
 *    time to anyone who can measure. Comparing SHA-256 digests rather than
 *    the raw strings means both sides are always 32 bytes, so
 *    `timingSafeEqual` cannot throw on a length mismatch — and the length
 *    of the real token does not leak either.
 *
 * 3. **Refuses a short token.** A 4-character token would satisfy every
 *    check above and still be guessable in an afternoon on a LAN. The
 *    minimum is the same shape `.env.example` tells the household to
 *    generate.
 */
export const HA_TOKEN_MIN_LENGTH = 32;

export type HaAuthResult = "authorized" | "not_configured" | "unauthorized";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * @param presented the bearer token from the request, if any.
 * @param configured the deployment's token. Required, and deliberately not
 *   defaulted to `process.env`: a default would mean `undefined` reads the
 *   real environment instead of meaning "nothing configured", which is
 *   exactly the confusion that made this function's own "fails closed"
 *   test pass for the wrong reason until a longer dev token exposed it.
 *   The caller reads the environment, the same way every other rule in
 *   this codebase takes its clock and timezone as arguments.
 */
export function checkHaToken(presented: string | null, configured: string | undefined): HaAuthResult {
  const expected = configured?.trim() ?? "";
  if (expected.length < HA_TOKEN_MIN_LENGTH) return "not_configured";

  if (!presented) return "unauthorized";

  return timingSafeEqual(digest(presented), digest(expected)) ? "authorized" : "unauthorized";
}

/**
 * Reads the token out of an `Authorization: Bearer …` header.
 *
 * Header only — never a query parameter. A token in a URL ends up in the
 * reverse proxy's access log, the browser's history and any screenshot of
 * the dashboard, which is exactly how a "read-only" credential stops being
 * confined to the people who were meant to have it.
 */
export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

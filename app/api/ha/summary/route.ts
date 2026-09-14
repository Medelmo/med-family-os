import { sql } from "drizzle-orm";
import { db } from "../../../../infrastructure/db/client";
import { households } from "../../../../db/schema";
import { bearerTokenFrom, checkHaToken } from "../../../../infrastructure/integrations/haToken";
import { getHouseholdGlance } from "../../../../application/queries/ha/getHouseholdGlance";

/**
 * `GET /api/ha/summary` — the read-only projection CLAUDE.md §10 defines.
 *
 * This route is in the proxy's public list, which means **the token check
 * below is the only thing standing in front of it**. That is deliberate —
 * the caller is a machine with no session — but it is also why this file
 * is short and does nothing clever: every line between the request and the
 * response is either the credential check or the projection, and the
 * projection is structurally incapable of returning free text.
 *
 * It answers for the household, singular. CLAUDE.md §0 says this app is
 * for one, and a token that could be pointed at a household id would be an
 * enumeration surface for no benefit. If a deployment somehow has more
 * than one, it refuses rather than guessing which one the wall tablet
 * meant.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = checkHaToken(bearerTokenFrom(request), process.env.HA_READONLY_TOKEN);

  if (auth === "not_configured") {
    // Not 401: there is nothing here to authenticate against. A deployment
    // that has not set a token has not opted in to this surface at all.
    return json({ error: "not_configured" }, 503);
  }
  if (auth === "unauthorized") {
    return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
  }

  const rows = await db.select({ id: households.id }).from(households).orderBy(sql`created_at`).limit(2);

  if (rows.length === 0) return json({ error: "no_household" }, 503);
  if (rows.length > 1) return json({ error: "ambiguous_household" }, 409);

  const glance = await getHouseholdGlance(rows[0].id);
  return json(glance, 200);
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // A dashboard polls this; a stale cached answer is worse than a
      // slightly expensive one, and it must never sit in a shared cache.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

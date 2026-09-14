import { currentActor } from "../../../../infrastructure/auth/currentActor";
import { exportExpensesCsv } from "../../../../application/queries/finance/getFinance";

/**
 * A month's expenses as a CSV download.
 *
 * A route handler rather than a Server Action because the answer *is* a
 * file: the browser needs a real response with `Content-Disposition`, and
 * a Server Action returns data to React, not a download to the user.
 *
 * Authorization is not inherited from anywhere. The route re-reads the
 * session and the export itself is built only from rows the actor may
 * read, so this endpoint can never widen access — which matters more here
 * than anywhere else in the app, because the result leaves the
 * application entirely and the household's protections with it.
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) {
    // Not a redirect: the caller asked for a file, so it gets a refusal it
    // can recognise rather than a sign-in page with a 200.
    return new Response("Not authenticated.", { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("month");
  if (!requested || !/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) {
    return new Response("Pass ?month=YYYY-MM.", { status: 400 });
  }

  const csv = await exportExpensesCsv(actor.actor, actor.householdId, requested);

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      // The filename is built from a value this handler has already
      // validated against a strict pattern, so it cannot carry a quote or
      // a newline into the header.
      "content-disposition": `attachment; filename="expenses-${requested}.csv"`,
      // This is household financial data. It must not sit in a shared
      // cache, and a browser should re-ask rather than re-serve it.
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

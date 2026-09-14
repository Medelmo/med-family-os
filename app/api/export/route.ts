import { requireActor } from "../../../infrastructure/auth/currentActor";
import { buildExport } from "../../../application/queries/export/buildExport";
import { recordAuditEvent } from "../../../application/audit/recordAuditEvent";
import { logger } from "../../../infrastructure/logging/logger";

/**
 * `GET /api/export` — the household's data as a file (screen 48).
 *
 * **A route rather than a Server Action.** An action returns a value to
 * React; a download needs a response with its own `Content-Disposition`,
 * and every trick for making an action produce one ends in a base64 data
 * URL held in browser memory — which for a file containing the
 * household's medical and financial records is precisely the wrong place
 * for it to sit.
 *
 * **A GET rather than a POST**, even though it is the most sensitive read
 * in the application. It performs no mutation, so a GET is the honest
 * verb, and CSRF is not the relevant risk: a cross-origin page can cause
 * this request but cannot read the response, and the worst it achieves is
 * making somebody download their own data. A POST would buy nothing and
 * cost the ability to simply link to it.
 *
 * What does the work is `buildExport`, which filters every record through
 * the same policy kernel as the page it came from. That is not a detail:
 * an export that read rows directly would be one click that hands a
 * household member every sensitive record in the house.
 */
export async function GET(): Promise<Response> {
  const { actor, householdId } = await requireActor();

  const bundle = await buildExport(actor, householdId);

  // Audited before the bytes leave, and audited unconditionally. "Somebody
  // took a copy of everything they can see" is the single most
  // audit-worthy action in this application — more than any individual
  // read, because it is all of them at once.
  //
  // The counts go in the metadata, never the content: recordAuditEvent's
  // contract is non-sensitive metadata only, and "412 expenses" is a fact
  // about the export while an expense is a fact about the household.
  await recordAuditEvent({
    householdId,
    actorUserId: actor.userId,
    action: "household.exported",
    resourceType: "household",
    resourceId: householdId,
    metadata: { formatVersion: bundle.formatVersion, counts: bundle.counts },
  });

  logger.info(
    { event: "household.exported", householdId, actorUserId: actor.userId, counts: bundle.counts },
    "household data exported"
  );

  const filename = `med-family-os-export-${bundle.generatedAt.slice(0, 10)}.json`;

  return new Response(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The filename is built from a date this server generated, so there
      // is nothing user-controlled in the header to inject into.
      "content-disposition": `attachment; filename="${filename}"`,
      // Never stored by anything on the way: this is the household's
      // records in plain text, and a proxy or browser cache holding a copy
      // is a copy nobody knows about.
      "cache-control": "no-store, private",
      // A browser that sniffs this as HTML would be rendering the
      // household's own records as a document on this origin.
      "x-content-type-options": "nosniff",
    },
  });
}

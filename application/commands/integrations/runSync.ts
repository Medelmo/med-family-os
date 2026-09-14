import { and, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { documentReferences, integrationConnections, syncRuns } from "../../../db/schema";
import { applySyncCommand, nextCursorAfter, type SyncCommand, type SyncRun } from "../../../domain/integrations/syncRun";
import { applyProviderUpdate, isSafeDocumentUrl } from "../../../domain/documents/documentReference";
import { createPaperlessProvider, withTimeout, PAPERLESS_TIMEOUT_MS } from "../../../infrastructure/integrations/paperless";
import { ProviderError, type DocumentProvider } from "../../integrations/documentProvider";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeIntegrationAccess } from "../../policies/integrations";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, NotFoundError } from "../../errors";
import { IntegrationRuleError, openIntegrationCredential } from "./connectionCommands";

/**
 * How many pages one run will take before stopping and leaving the rest
 * for the next one.
 *
 * A bound rather than "until the provider says stop": a first sync against
 * a Paperless with ten thousand documents would otherwise hold one
 * transaction-free loop open for minutes, and the household would have no
 * idea whether it was working. Stopping early is a `PARTIAL`, which is
 * exactly the state for "real progress, not finished".
 */
export const MAX_PAGES_PER_RUN = 10;

export interface SyncOutcome {
  runId: string;
  status: SyncRun["status"];
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
}

/**
 * Runs one synchronisation.
 *
 * The shape follows CLAUDE.md §8's outbox discipline in spirit: the domain
 * change and the record of it are written together, and no toast is
 * treated as proof anything happened. Every outcome — success, partial,
 * failure — ends with a persisted `sync_run` row saying what occurred, so
 * "is this integration healthy?" is answerable from data rather than from
 * whoever happened to be watching.
 *
 * Each page is imported in its own transaction. A failure on page four
 * therefore keeps pages one to three, which is the whole point of
 * `PARTIAL` and is why the cursor is advanced per page rather than at the
 * end.
 */
export async function runSync(
  actor: Actor,
  householdId: string,
  connectionId: string,
  options: { providerFactory?: (baseUrl: string, token: string) => DocumentProvider; now?: Date } = {}
): Promise<SyncOutcome> {
  if (!authorizeIntegrationAccess(actor, householdId)) {
    throw new AuthorizationError("Only an owner or admin may run a sync.");
  }

  const now = options.now ?? new Date();

  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.householdId, householdId)))
    .limit(1);

  if (!connection) throw new NotFoundError("Integration not found.");
  if (!connection.enabled) {
    throw new IntegrationRuleError("DISABLED", "This integration is switched off.");
  }
  if (connection.provider !== "PAPERLESS") {
    // The port exists and the sync driver is provider-agnostic; only
    // Paperless has an adapter so far. Saying so beats a confusing empty
    // run.
    throw new IntegrationRuleError("NO_ADAPTER", "There is no adapter for this provider yet.");
  }

  const [run] = await db
    .insert(syncRuns)
    .values({ householdId, connectionId, cursorBefore: connection.cursor })
    .returning();

  let state = run as unknown as SyncRun;
  state = await transition(state, { type: "START" }, now, householdId, actor);

  let cursor = connection.cursor;
  let seen = 0;
  let imported = 0;
  let skipped = 0;

  try {
    const token = await openIntegrationCredential(householdId, connectionId);
    const provider =
      options.providerFactory?.(connection.baseUrl, token) ??
      createPaperlessProvider({ baseUrl: connection.baseUrl, apiToken: token });

    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const result = await withTimeout(PAPERLESS_TIMEOUT_MS, (signal) => provider.listDocuments(cursor, signal));

      const counts = await importPage(householdId, connectionId, connection.provider, result.documents, now);
      seen += result.documents.length;
      imported += counts.imported;
      skipped += counts.skipped;

      cursor = result.nextCursor;
      await advanceCursor(connectionId, cursor, now);

      if (!cursor) break;
    }

    state = await transition(
      state,
      { type: "SUCCEED", progress: { itemsSeen: seen, itemsImported: imported, itemsSkipped: skipped, cursorAfter: cursor } },
      now,
      householdId,
      actor
    );

    await db
      .update(integrationConnections)
      .set({ lastSyncAt: now, lastSuccessAt: now })
      .where(eq(integrationConnections.id, connectionId));
  } catch (error) {
    const { kind, message } = describeFailure(error);

    // Work already done is kept. A run that imported eleven documents and
    // choked on the twelfth is PARTIAL, not FAILED — re-importing the
    // eleven on the next attempt would be wasteful and, worse, would make
    // the counts meaningless.
    const command: SyncCommand =
      imported > 0
        ? {
            type: "PARTIAL",
            progress: { itemsSeen: seen, itemsImported: imported, itemsSkipped: skipped, cursorAfter: cursor },
            errorKind: kind,
            errorMessage: message,
          }
        : { type: "FAIL", errorKind: kind, errorMessage: message };

    state = await transition(state, command, now, householdId, actor);

    await db
      .update(integrationConnections)
      .set({ lastSyncAt: now })
      .where(eq(integrationConnections.id, connectionId));
  }

  return {
    runId: state.id,
    status: state.status,
    itemsSeen: seen,
    itemsImported: imported,
    itemsSkipped: skipped,
  };
}

/**
 * What gets written into the sync run for each kind of failure.
 *
 * A fixed table, and this application's own words. The stored message is
 * shown in the UI and kept indefinitely, and **no part of it comes from
 * the thing that failed** — an upstream error text routinely names the URL
 * it was called with, and a URL can carry a credential.
 *
 * This was not a hypothetical. The first version of `describeFailure`
 * stored `error.message.slice(0, 300)`, and the test that asserts a token
 * never reaches a sync run failed immediately: the adapter had
 * interpolated the cause into its own message, and the driver had passed
 * it straight through. Both ends are fixed; this is the belt.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  auth: "The provider rejected the stored credential. Replace the token and try again.",
  not_found: "The provider had no such endpoint. Check the base URL.",
  rate_limit: "The provider asked us to slow down. The next run will pick up where this one stopped.",
  network: "The provider could not be reached.",
  server: "The provider returned an error.",
  malformed: "The provider returned something this app could not read.",
  configuration: "This integration is not configured correctly.",
  unexpected: "The sync failed for an unexpected reason. See the application log.",
};

function describeFailure(error: unknown): { kind: string; message: string } {
  const kind =
    error instanceof ProviderError
      ? error.kind
      : error instanceof IntegrationRuleError
        ? "configuration"
        : "unexpected";

  return { kind, message: FAILURE_MESSAGES[kind] ?? FAILURE_MESSAGES.unexpected };
}

async function transition(
  run: SyncRun,
  command: SyncCommand,
  now: Date,
  householdId: string,
  actor: Actor
): Promise<SyncRun> {
  const result = applySyncCommand(run, command, now);
  if (!result.ok) {
    // A sync run whose own state machine refuses a transition is a bug in
    // this driver, not a user error — it must not be swallowed into a
    // "failed" row that hides it.
    throw new Error(`Illegal sync transition: ${result.rejection.message}`);
  }

  const [updated] = await db
    .update(syncRuns)
    .set(result.transition.patch)
    .where(eq(syncRuns.id, run.id))
    .returning();

  await recordAuditEvent({
    householdId,
    actorUserId: actor.userId,
    action: result.transition.auditAction,
    resourceType: "sync_run",
    resourceId: run.id,
  });

  return updated as unknown as SyncRun;
}

async function advanceCursor(connectionId: string, cursor: string | null, now: Date): Promise<void> {
  await db
    .update(integrationConnections)
    .set({ cursor, updatedAt: now })
    .where(eq(integrationConnections.id, connectionId));
}

/**
 * Writes one page of documents.
 *
 * An upsert keyed on (household, provider, externalId) — the unique index
 * makes re-importing the same page a no-op rather than a duplicate, so
 * idempotency is a database property rather than something the adapter has
 * to get right.
 *
 * Only provider-owned columns are written on conflict. `title_override`
 * and `note` are the household's, and a sync cannot reach them; that is
 * how "a sync run must never silently overwrite local edits" is enforced
 * (domain/documents/documentReference.ts).
 */
async function importPage(
  householdId: string,
  connectionId: string,
  provider: "PAPERLESS" | "NEXTCLOUD" | "CALDAV",
  documents: { externalId: string; title: string; documentDate: string | null; url: string | null }[],
  now: Date
): Promise<{ imported: number; skipped: number }> {
  if (documents.length === 0) return { imported: 0, skipped: 0 };

  const documentProvider = provider === "NEXTCLOUD" ? "NEXTCLOUD" : "PAPERLESS";
  let imported = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const incoming of documents) {
      // A link the household would click, from a system this app does not
      // vet. Refused rather than stored and rendered.
      if (!isSafeDocumentUrl(incoming.url)) {
        skipped += 1;
        continue;
      }

      const [existing] = await tx
        .select()
        .from(documentReferences)
        .where(
          and(
            eq(documentReferences.householdId, householdId),
            eq(documentReferences.provider, documentProvider),
            eq(documentReferences.externalId, incoming.externalId)
          )
        )
        .limit(1);

      if (!existing) {
        await tx.insert(documentReferences).values({
          householdId,
          provider: documentProvider,
          externalId: incoming.externalId,
          connectionId,
          title: incoming.title,
          documentDate: incoming.documentDate,
          url: incoming.url,
        });
        imported += 1;
        continue;
      }

      const patch = applyProviderUpdate(existing, incoming);
      if (!patch) {
        // Unchanged. Counted as skipped rather than imported so "what did
        // this run actually do?" has an honest answer.
        skipped += 1;
        continue;
      }

      await tx
        .update(documentReferences)
        .set({ ...patch, updatedAt: now, version: existing.version + 1 })
        .where(eq(documentReferences.id, existing.id));
      imported += 1;
    }
  });

  return { imported, skipped };
}

/** Where the next run should start, given how the last one ended. */
export function resumeCursor(run: Pick<SyncRun, "status" | "cursorAfter" | "cursorBefore">): string | null {
  return nextCursorAfter(run);
}

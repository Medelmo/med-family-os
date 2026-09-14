import { and, eq } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { documentReferences, integrationConnections, syncRuns } from "../../../db/schema";
import { applySyncCommand, nextCursorAfter, type SyncCommand, type SyncRun } from "../../../domain/integrations/syncRun";
import type { SyncTrigger } from "../../../domain/integrations/syncSchedule";
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

export interface SyncOptions {
  providerFactory?: (baseUrl: string, token: string) => DocumentProvider;
  now?: Date;
}

/**
 * Who, or what, caused this run — recorded on every audit event.
 *
 * A scheduled or retried run has no user behind it, and inventing one
 * would put a false name in the audit trail. `actorUserId: null` plus an
 * explicit trigger says what actually happened: nobody asked, the
 * schedule did.
 */
interface RunAttribution {
  actorUserId: string | null;
  trigger: SyncTrigger;
}

/**
 * Postgres unique-violation (SQLSTATE 23505). Raised here by the partial
 * unique index that allows one live run per connection, which is how a run
 * claims its connection (ADR-023).
 *
 * **The chain has to be walked.** Drizzle wraps driver errors in a
 * `DrizzleQueryError` whose own `code` is undefined and whose `cause` is
 * the `PostgresError` that carries it. Checking only the top level looked
 * right, passed nothing, and would have shipped a raw constraint violation
 * to the user as a 500 the first time two syncs overlapped — which the
 * integration test caught on its first run.
 *
 * Bounded rather than recursive without a limit: a cyclic `cause` is
 * unlikely but a hung loop in an error handler is a miserable way to find
 * out.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
  options: SyncOptions = {}
): Promise<SyncOutcome> {
  if (!authorizeIntegrationAccess(actor, householdId)) {
    throw new AuthorizationError("Only an owner or admin may run a sync.");
  }

  const now = options.now ?? new Date();
  const connection = await loadSyncableConnection(householdId, connectionId);

  let run: typeof syncRuns.$inferSelect;
  try {
    [run] = await db
      .insert(syncRuns)
      .values({ householdId, connectionId, cursorBefore: connection.cursor })
      .returning();
  } catch (error) {
    // The one-live-run-per-connection index. Somebody — or the scheduler —
    // is already syncing this connection, and two runs sharing one cursor
    // would double the work and confuse the counts.
    if (isUniqueViolation(error)) {
      throw new IntegrationRuleError("ALREADY_RUNNING", "This integration is already syncing. Wait for it to finish.");
    }
    throw error;
  }

  return executeRun(run as unknown as SyncRun, connection, { actorUserId: actor.userId, trigger: "MANUAL" }, now, options);
}

/**
 * Starts a run that nobody asked for.
 *
 * Identical to `runSync` except that there is no `Actor` and therefore no
 * authorization check — which is deliberate, not an oversight. There is no
 * user here whose permissions could be checked, and inventing a
 * "system user" would put a name in the audit trail that belongs to
 * nobody. What stands in for authorization is that this is unreachable
 * from any route or Server Action: its only caller is the scheduler, which
 * selects connections by the household's own stored interval. A household
 * authorizes unattended syncing once, by setting that interval, and the
 * command that sets it *does* check permissions.
 */
export async function runScheduledSync(
  householdId: string,
  connectionId: string,
  options: SyncOptions = {}
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();
  const connection = await loadSyncableConnection(householdId, connectionId);

  let run: typeof syncRuns.$inferSelect;
  try {
    [run] = await db
      .insert(syncRuns)
      .values({ householdId, connectionId, cursorBefore: connection.cursor })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new IntegrationRuleError("ALREADY_RUNNING", "This integration is already syncing.");
    }
    throw error;
  }

  return executeRun(run as unknown as SyncRun, connection, { actorUserId: null, trigger: "SCHEDULE" }, now, options);
}

/**
 * Picks a `FAILED` run back up.
 *
 * Not a new run: the same row, with `attempt` incremented, so "this
 * connection has failed four times in a row" stays a single readable
 * history instead of four unrelated rows that somebody has to correlate.
 * That is what `FAILED -> RETRYING -> RUNNING` in
 * `docs/domain/state-machines.md` has always described.
 *
 * There is no `Actor` parameter and no authorization check, and that is
 * deliberate rather than an omission: this is only reachable from the
 * scheduler, which is not acting for anybody. It is not exported to any
 * UI or route, and it takes a run id it has already selected under the
 * scheduler's own rules — it cannot be pointed at an arbitrary row by a
 * request. If a "retry now" button is ever added, it must go through a
 * command that authorizes, exactly as `runSync` does.
 */
export async function retrySyncRun(
  householdId: string,
  runId: string,
  options: SyncOptions = {}
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();

  const [row] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Sync run not found.");

  const connection = await loadSyncableConnection(householdId, row.connectionId);

  let retrying: SyncRun;
  try {
    retrying = await transition(row as unknown as SyncRun, { type: "RETRY" }, now, householdId, {
      actorUserId: null,
      trigger: "RETRY",
    });
  } catch (error) {
    // Another scheduler tick got there first, or somebody pressed "Sync
    // now" in the meantime: the live-run index refused to let this row
    // become live. Nothing to report — the connection is being synced.
    if (isUniqueViolation(error)) {
      throw new IntegrationRuleError("ALREADY_RUNNING", "This integration is already syncing. Wait for it to finish.");
    }
    throw error;
  }

  return executeRun(retrying, connection, { actorUserId: null, trigger: "RETRY" }, now, options);
}

/**
 * Loads a connection and refuses the ones that cannot sync.
 *
 * Shared by the manual and the scheduled path so "is this thing syncable"
 * has one answer. The scheduler's query filters on the same facts, but it
 * re-checks here because between the query and the run somebody may have
 * switched the connection off.
 */
async function loadSyncableConnection(householdId: string, connectionId: string) {
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

  return connection;
}

/**
 * Drives one run from `RUNNING` to whatever it ends as.
 *
 * Separated from `runSync` because a retry does not create a run — it
 * revives the one that failed, keeping its history and its attempt count
 * — and both paths must then do exactly the same thing. Two copies of
 * this loop would be two chances for the retry path to handle `PARTIAL`
 * or the cursor differently from the first attempt.
 */
async function executeRun(
  initial: SyncRun,
  connection: typeof integrationConnections.$inferSelect,
  attribution: RunAttribution,
  now: Date,
  options: SyncOptions
): Promise<SyncOutcome> {
  const householdId = connection.householdId;
  const connectionId = connection.id;

  let state = await transition(initial, { type: "START" }, now, householdId, attribution);

  // The connection's own cursor, not the run's `cursorBefore`. For a retry
  // they are usually the same — a FAILED run imported nothing — but a run
  // can fail after a page that was entirely skips, which advances the
  // cursor without importing. Resuming from the live cursor re-reads
  // nothing that was already dealt with.
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
      attribution
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

    state = await transition(state, command, now, householdId, attribution);

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
  attribution: RunAttribution
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
    actorUserId: attribution.actorUserId,
    action: result.transition.auditAction,
    resourceType: "sync_run",
    resourceId: run.id,
    // Without this, a scheduled run and a manual one are indistinguishable
    // in the audit trail apart from a null actor — and "nobody" is not the
    // same answer as "the schedule".
    metadata: { trigger: attribution.trigger },
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

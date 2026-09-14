import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { documentReferences, integrationConnections, syncRuns } from "../../../db/schema";
import type { SyncRunStatus } from "../../../domain/integrations/syncRun";
import type { DocumentProviderId } from "../../../domain/documents/documentReference";
import { authorizeDocumentAccess, authorizeIntegrationAccess } from "../../policies/integrations";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

export interface SyncRunSummary {
  id: string;
  status: SyncRunStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  itemsImported: number;
  itemsSkipped: number;
  errorKind: string | null;
  errorMessage: string | null;
}

export interface IntegrationSummary {
  id: string;
  provider: "PAPERLESS" | "NEXTCLOUD" | "CALDAV";
  displayName: string;
  baseUrl: string;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  version: number;
  /** The most recent runs, newest first — this is "sync health" (screen 46). */
  recentRuns: SyncRunSummary[];
}

/**
 * The integrations page's single read.
 *
 * Deliberately never selects from `integration_credential`. Nothing on a
 * settings page needs the ciphertext, and a query that fetched it would
 * eventually end up serialised into a React payload — which is how a
 * sealed value becomes a value in the browser's memory (ADR-019).
 */
export async function getIntegrations(actor: Actor, householdId: string): Promise<IntegrationSummary[]> {
  if (!authorizeIntegrationAccess(actor, householdId)) {
    throw new AuthorizationError("Only an owner or admin may view integrations.");
  }

  const connections = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.householdId, householdId))
    .orderBy(desc(integrationConnections.createdAt));

  if (connections.length === 0) return [];

  const runs = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.householdId, householdId))
    .orderBy(desc(syncRuns.createdAt))
    .limit(50);

  return connections.map((connection) => ({
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    baseUrl: connection.baseUrl,
    enabled: connection.enabled,
    lastSyncAt: connection.lastSyncAt,
    lastSuccessAt: connection.lastSuccessAt,
    version: connection.version,
    recentRuns: runs
      .filter((run) => run.connectionId === connection.id)
      .slice(0, 5)
      .map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        itemsImported: run.itemsImported,
        itemsSkipped: run.itemsSkipped,
        errorKind: run.errorKind,
        errorMessage: run.errorMessage,
      })),
  }));
}

export interface DocumentReferenceView {
  id: string;
  provider: DocumentProviderId;
  title: string;
  documentDate: string | null;
  url: string | null;
  note: string | null;
  version: number;
}

/**
 * Document references the actor may see.
 *
 * References default to `SENSITIVE`, so the policy kernel keeps them away
 * from child accounts without a rule of its own — the same mechanism as
 * expenses (ADR-015 §4).
 *
 * `title` is what the household should see it called: the query resolves
 * the override here so no caller can forget to.
 */
export async function getDocumentReferences(
  actor: Actor,
  householdId: string,
  limit = 100
): Promise<DocumentReferenceView[]> {
  const rows = await db
    .select()
    .from(documentReferences)
    .where(and(eq(documentReferences.householdId, householdId), isNull(documentReferences.archivedAt)))
    .orderBy(desc(documentReferences.documentDate), desc(documentReferences.createdAt))
    .limit(limit);

  return rows
    .filter((row) =>
      authorizeDocumentAccess(actor, "read", {
        householdId: row.householdId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
        createdBy: row.createdBy,
        personScopeIds: [],
      })
    )
    .map((row) => ({
      id: row.id,
      provider: row.provider,
      title: row.titleOverride ?? row.title,
      documentDate: row.documentDate,
      url: row.url,
      note: row.note,
      version: row.version,
    }));
}

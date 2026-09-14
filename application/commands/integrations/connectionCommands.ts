import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { integrationConnections, integrationCredentials } from "../../../db/schema";
import { getKeyring } from "../../../infrastructure/crypto/keyring";
import {
  credentialContext,
  keyIdOf,
  openSecret,
  resealSecret,
  sealSecret,
} from "../../../infrastructure/crypto/secretBox";
import { MIN_SYNC_INTERVAL_MINUTES } from "../../../domain/integrations/syncSchedule";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeIntegrationAccess } from "../../policies/integrations";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class IntegrationRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IntegrationRuleError";
    this.code = code;
  }
}

export const CREDENTIAL_PURPOSE = "api_token";

const connectSchema = z.object({
  provider: z.enum(["PAPERLESS", "NEXTCLOUD", "CALDAV"]),
  displayName: z.string().trim().min(1).max(120),
  /**
   * Validated as an absolute http(s) URL, not merely non-empty. This
   * string becomes both a fetch target and a rendered link, so `file://`
   * or `javascript:` here would be a server-side request forgery on one
   * side and script execution on the other.
   */
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    }, "Use a full http:// or https:// address."),
  apiToken: z.string().min(1).max(2000),
});

export type ConnectIntegrationInput = z.input<typeof connectSchema>;

/**
 * Configures a connection and seals its credential.
 *
 * The token goes straight from the form into `sealSecret` and is never
 * written anywhere else — not to the connection row, not to the audit
 * event, not to a log line. The audit record says a credential was
 * stored and which key sealed it, which is what an auditor needs and is
 * not itself a secret.
 *
 * Both writes happen in one transaction. A connection without its
 * credential would be a row that fails on every sync with no way for the
 * household to tell why, and a credential without its connection would be
 * ciphertext nobody can attribute.
 */
export async function connectIntegration(actor: Actor, householdId: string, input: ConnectIntegrationInput) {
  if (!authorizeIntegrationAccess(actor, householdId)) {
    throw new AuthorizationError("Only an owner or admin may configure an integration.");
  }

  const parsed = connectSchema.parse(input);

  // Resolved before the transaction opens: a misconfigured keyring must
  // fail before anything is written, not halfway through.
  const keyring = getKeyring();

  return db.transaction(async (tx) => {
    const [connection] = await tx
      .insert(integrationConnections)
      .values({
        householdId,
        provider: parsed.provider,
        displayName: parsed.displayName,
        baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
        createdBy: actor.userId,
      })
      .returning();

    const sealed = sealSecret(
      keyring,
      parsed.apiToken,
      credentialContext(householdId, connection.id, CREDENTIAL_PURPOSE)
    );

    await tx.insert(integrationCredentials).values({
      householdId,
      connectionId: connection.id,
      purpose: CREDENTIAL_PURPOSE,
      keyId: keyring.activeKeyId,
      sealed,
    });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "integration.connected",
        resourceType: "integration_connection",
        resourceId: connection.id,
        // Provider and key id, never the token or the URL's credentials.
        metadata: { provider: parsed.provider, keyId: keyring.activeKeyId },
      },
      tx
    );

    return connection;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadConnection(tx: Tx, actor: Actor, householdId: string, connectionId: string) {
  if (!authorizeIntegrationAccess(actor, householdId)) {
    throw new AuthorizationError("Only an owner or admin may change an integration.");
  }

  const [row] = await tx
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Integration not found.");
  return row;
}

export async function setIntegrationEnabled(
  actor: Actor,
  householdId: string,
  connectionId: string,
  expectedVersion: number,
  enabled: boolean,
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const row = await loadConnection(tx, actor, householdId, connectionId);

    const updated = await tx
      .update(integrationConnections)
      .set({ enabled, updatedAt: now, version: row.version + 1 })
      .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This integration was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: enabled ? "integration.enabled" : "integration.disabled",
        resourceType: "integration_connection",
        resourceId: connectionId,
      },
      tx
    );

    return updated[0];
  });
}

/**
 * Sets how often a connection syncs by itself, or turns that off.
 *
 * `null` means manual only. This command is what a household uses to
 * authorize unattended outbound requests on its behalf — the scheduler
 * itself has no actor and checks no permissions (see `runScheduledSync`),
 * so the permission check has to happen here, once, when the standing
 * instruction is given. Owner or admin, like every other change to an
 * integration.
 */
export async function setSyncInterval(
  actor: Actor,
  householdId: string,
  connectionId: string,
  expectedVersion: number,
  intervalMinutes: number | null,
  now: Date = new Date()
) {
  if (intervalMinutes !== null) {
    if (!Number.isInteger(intervalMinutes)) {
      throw new IntegrationRuleError("INTERVAL_INVALID", "Choose one of the offered intervals.");
    }
    if (intervalMinutes < MIN_SYNC_INTERVAL_MINUTES) {
      throw new IntegrationRuleError(
        "INTERVAL_TOO_SHORT",
        `Sync no more often than every ${MIN_SYNC_INTERVAL_MINUTES} minutes.`
      );
    }
  }

  return db.transaction(async (tx) => {
    const row = await loadConnection(tx, actor, householdId, connectionId);

    const updated = await tx
      .update(integrationConnections)
      .set({ syncIntervalMinutes: intervalMinutes, updatedAt: now, version: row.version + 1 })
      .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This integration was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: intervalMinutes === null ? "integration.schedule_cleared" : "integration.schedule_set",
        resourceType: "integration_connection",
        resourceId: connectionId,
        metadata: { intervalMinutes },
      },
      tx
    );

    return updated[0];
  });
}

/**
 * Replaces the stored credential.
 *
 * A separate command from editing the connection, because replacing a
 * token is the thing a household does when it thinks one has leaked, and
 * that should not require also re-entering a display name and a URL.
 * Always sealed under the *active* key, so replacing a token is
 * incidentally a rotation.
 */
export async function replaceIntegrationCredential(
  actor: Actor,
  householdId: string,
  connectionId: string,
  apiToken: string,
  now: Date = new Date()
) {
  if (!apiToken.trim()) throw new IntegrationRuleError("TOKEN_REQUIRED", "Enter the new token.");

  const keyring = getKeyring();

  return db.transaction(async (tx) => {
    await loadConnection(tx, actor, householdId, connectionId);

    const sealed = sealSecret(keyring, apiToken, credentialContext(householdId, connectionId, CREDENTIAL_PURPOSE));

    await tx
      .insert(integrationCredentials)
      .values({
        householdId,
        connectionId,
        purpose: CREDENTIAL_PURPOSE,
        keyId: keyring.activeKeyId,
        sealed,
        rotatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrationCredentials.connectionId, integrationCredentials.purpose],
        set: { keyId: keyring.activeKeyId, sealed, rotatedAt: now, updatedAt: now },
      });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "integration.credential_replaced",
        resourceType: "integration_connection",
        resourceId: connectionId,
        metadata: { keyId: keyring.activeKeyId },
      },
      tx
    );
  });
}

/**
 * Opens a connection's credential, for the adapter that is about to use
 * it.
 *
 * The only reader of the credential table. Returns a bare string with no
 * wrapper type on purpose — a `Secret` class would suggest the value is
 * protected once it exists, which it is not; what protects it is that
 * nothing between here and the `Authorization` header stores or logs it.
 */
export async function openIntegrationCredential(householdId: string, connectionId: string): Promise<string> {
  const [row] = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.connectionId, connectionId),
        eq(integrationCredentials.householdId, householdId),
        eq(integrationCredentials.purpose, CREDENTIAL_PURPOSE)
      )
    )
    .limit(1);

  if (!row) throw new IntegrationRuleError("NO_CREDENTIAL", "This integration has no stored credential.");

  return openSecret(getKeyring(), row.sealed, credentialContext(householdId, connectionId, CREDENTIAL_PURPOSE));
}

export interface RotationResult {
  examined: number;
  resealed: number;
}

/**
 * Re-seals every credential under the active key.
 *
 * The other half of ADR-019's rotation story: add a key, point the active
 * id at it, run this, then drop the old key. Rows already on the active
 * key are skipped without a write — the `key_id` column exists so this
 * can be an indexed lookup rather than opening every credential to find
 * out.
 */
export async function rotateIntegrationCredentials(
  actor: Actor,
  householdId: string,
  now: Date = new Date()
): Promise<RotationResult> {
  if (!authorizeIntegrationAccess(actor, householdId)) {
    throw new AuthorizationError("Only an owner or admin may rotate credentials.");
  }

  const keyring = getKeyring();

  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(eq(integrationCredentials.householdId, householdId));

  let resealed = 0;

  for (const row of rows) {
    if (keyIdOf(row.sealed) === keyring.activeKeyId) continue;

    const next = resealSecret(
      keyring,
      row.sealed,
      credentialContext(householdId, row.connectionId, row.purpose)
    );
    if (!next) continue;

    await db
      .update(integrationCredentials)
      .set({ sealed: next, keyId: keyring.activeKeyId, rotatedAt: now, updatedAt: now })
      .where(eq(integrationCredentials.id, row.id));

    resealed += 1;
  }

  if (resealed > 0) {
    await recordAuditEvent({
      householdId,
      actorUserId: actor.userId,
      action: "integration.credentials_rotated",
      resourceType: "integration_credential",
      metadata: { resealed, keyId: keyring.activeKeyId },
    });
  }

  return { examined: rows.length, resealed };
}

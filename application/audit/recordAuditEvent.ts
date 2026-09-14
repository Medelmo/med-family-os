import { db } from "../../infrastructure/db/client";
import { auditEvents } from "../../db/schema";
import type { Database, Transaction } from "../../infrastructure/db/client";

export interface AuditEventInput {
  householdId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  /**
   * Non-sensitive metadata only. docs/security/security-model.md: never
   * expose sensitive data in logs; the same rule applies here since audit
   * rows are read by ADULT/OWNER/ADMIN users, not restricted the way a
   * SENSITIVE/HIGHLY_SENSITIVE domain record would be. Do not pass raw
   * document contents, financial amounts, or child-sensitive details —
   * record that the action happened and which resource it touched, not the
   * sensitive payload itself.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Records an immutable audit event in the same transaction as the domain
 * write that caused it, when called with a transactional `db` handle
 * (docs/domain/domain-model.md: "AuditEvent: Immutable security/operational
 * record."). Pass the transaction's `tx` as `handle` from inside a
 * `db.transaction(async (tx) => ...)` block; defaults to the module-level
 * `db` for call sites that aren't already inside one.
 */
export async function recordAuditEvent(input: AuditEventInput, handle: Database | Transaction = db): Promise<void> {
  await handle.insert(auditEvents).values({
    householdId: input.householdId,
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ?? null,
  });
}

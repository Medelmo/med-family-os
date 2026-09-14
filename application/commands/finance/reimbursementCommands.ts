import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { expenses, reimbursementEvents, reimbursements } from "../../../db/schema";
import {
  applyReimbursementCommand,
  type Reimbursement,
  type ReimbursementCommand,
} from "../../../domain/finance/reimbursement";
import { DEFAULT_CURRENCY } from "../../../domain/finance/money";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeReimbursementAccess } from "../../policies/finance";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class IllegalReimbursementTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IllegalReimbursementTransitionError";
    this.code = code;
  }
}

export class ExpenseLinkError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ExpenseLinkError";
    this.code = code;
  }
}

const createReimbursementSchema = z.object({
  title: z.string().trim().min(1).max(300),
  counterparty: z.string().trim().max(200).nullish(),
  externalReference: z.string().trim().max(200).nullish(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .default(DEFAULT_CURRENCY),
  notes: z.string().trim().max(2000).nullish(),
  /** Expenses to attach immediately; the claimed amount is their sum. */
  expenseIds: z.array(z.string().uuid()).default([]),
});

export type CreateReimbursementInput = z.input<typeof createReimbursementSchema>;

export async function createReimbursement(actor: Actor, householdId: string, input: CreateReimbursementInput) {
  const parsed = createReimbursementSchema.parse(input);

  const authorized = authorizeReimbursementAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "SENSITIVE",
    createdBy: actor.userId,
    personScopeIds: [],
  });
  if (!authorized) throw new AuthorizationError("Not permitted to open a claim in this household.");

  return db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(reimbursements)
      .values({
        householdId,
        title: parsed.title,
        counterparty: parsed.counterparty ?? null,
        externalReference: parsed.externalReference ?? null,
        currency: parsed.currency,
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    if (parsed.expenseIds.length > 0) {
      await attachExpenses(tx, householdId, claim.id, claim.currency, parsed.expenseIds, actor);
    }

    await tx.insert(reimbursementEvents).values({
      reimbursementId: claim.id,
      householdId,
      type: "CREATED",
      summary: "Claim opened",
      actorUserId: actor.userId,
    });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "reimbursement.created",
        resourceType: "reimbursement",
        resourceId: claim.id,
      },
      tx
    );

    // Re-read so the caller sees the claimed amount the attachments set.
    const [fresh] = await tx.select().from(reimbursements).where(eq(reimbursements.id, claim.id)).limit(1);
    return fresh;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Attaches expenses and recomputes the claimed amount from them.
 *
 * The claimed amount is never set directly. It is always the sum of the
 * attached expenses, so the figure the household chases and the receipts
 * it can produce to justify it cannot drift apart — which is the whole
 * reason a claim is "associated with one or more expenses" in
 * docs/domain/domain-model.md rather than carrying a free-standing number.
 *
 * Currencies are not converted (ADR-015 §5): an expense in another
 * currency is refused rather than folded in at an unverifiable rate.
 */
async function attachExpenses(
  tx: Tx,
  householdId: string,
  reimbursementId: string,
  claimCurrency: string,
  expenseIds: string[],
  actor: Actor
) {
  const rows = await tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.householdId, householdId), inArray(expenses.id, expenseIds)));

  // An id that names nothing in *this* household must not be treated as
  // "already linked" or silently skipped — that is the shape an IDOR probe
  // takes, and the household deserves to know its claim is incomplete.
  if (rows.length !== expenseIds.length) {
    throw new NotFoundError("One of those expenses does not exist in this household.");
  }

  for (const row of rows) {
    if (row.archivedAt) {
      throw new ExpenseLinkError("EXPENSE_ARCHIVED", `"${row.description}" is archived and cannot be claimed.`);
    }
    if (row.currency !== claimCurrency) {
      throw new ExpenseLinkError(
        "CURRENCY_MISMATCH",
        `"${row.description}" is in ${row.currency}; this claim is in ${claimCurrency}.`
      );
    }
    if (row.reimbursementId && row.reimbursementId !== reimbursementId) {
      throw new ExpenseLinkError("ALREADY_CLAIMED", `"${row.description}" is already on another claim.`);
    }
    const authorized = authorizeReimbursementAccess(actor, "update", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: row.personId ? [row.personId] : [],
    });
    if (!authorized) throw new AuthorizationError("Not permitted to claim one of those expenses.");
  }

  await tx
    .update(expenses)
    .set({ reimbursementId })
    .where(and(eq(expenses.householdId, householdId), inArray(expenses.id, expenseIds)));

  await recomputeClaimedAmount(tx, reimbursementId);
}

/**
 * Sums the attached expenses in SQL rather than in JavaScript, so the total
 * is computed from the rows as they stand inside this transaction and
 * cannot be stale.
 */
async function recomputeClaimedAmount(tx: Tx, reimbursementId: string) {
  await tx
    .update(reimbursements)
    .set({
      claimedAmountMinor: sql`coalesce((
        select sum(${expenses.amountMinor})
        from ${expenses}
        where ${expenses.reimbursementId} = ${reimbursementId}
          and ${expenses.archivedAt} is null
      ), 0)`,
      updatedAt: new Date(),
    })
    .where(eq(reimbursements.id, reimbursementId));
}

export async function linkExpensesToReimbursement(
  actor: Actor,
  householdId: string,
  reimbursementId: string,
  expenseIds: string[]
) {
  return db.transaction(async (tx) => {
    const claim = await loadClaimForUpdate(tx, actor, householdId, reimbursementId);

    // Attaching an expense changes what is being claimed. Once a claim has
    // been submitted, that figure is what the counterparty is working from,
    // so changing it silently would make the household's record disagree
    // with the claim actually lodged. A new expense goes on a new claim.
    if (claim.status !== "PLANNED") {
      throw new ExpenseLinkError(
        "CLAIM_NOT_EDITABLE",
        "This claim has already been submitted; open a new claim for further expenses."
      );
    }

    await attachExpenses(tx, householdId, reimbursementId, claim.currency, expenseIds, actor);

    await tx.insert(reimbursementEvents).values({
      reimbursementId,
      householdId,
      type: "EXPENSE_LINKED",
      summary: `${expenseIds.length} expense(s) attached`,
      actorUserId: actor.userId,
    });

    const [fresh] = await tx.select().from(reimbursements).where(eq(reimbursements.id, reimbursementId)).limit(1);
    return fresh;
  });
}

async function loadClaimForUpdate(tx: Tx, actor: Actor, householdId: string, reimbursementId: string) {
  const [row] = await tx
    .select()
    .from(reimbursements)
    .where(and(eq(reimbursements.id, reimbursementId), eq(reimbursements.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Claim not found.");

  const authorized = authorizeReimbursementAccess(actor, "update", {
    householdId: row.householdId,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    createdBy: row.createdBy,
    personScopeIds: [],
  });
  if (!authorized) throw new AuthorizationError("Not permitted to change this claim.");

  return row;
}

/**
 * The only path by which a claim's status changes — the same division of
 * responsibility as transitionCase: the pure domain function decides, this
 * owns the transaction, authorization, optimistic concurrency, the audit
 * record and the timeline entry.
 */
export async function transitionReimbursement(
  actor: Actor,
  householdId: string,
  reimbursementId: string,
  expectedVersion: number,
  command: ReimbursementCommand,
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const row = await loadClaimForUpdate(tx, actor, householdId, reimbursementId);

    const result = applyReimbursementCommand(row as unknown as Reimbursement, command, now);
    if (!result.ok) {
      throw new IllegalReimbursementTransitionError(result.rejection.code, result.rejection.message);
    }

    const updated = await tx
      .update(reimbursements)
      .set({ ...result.transition.patch, updatedAt: now, version: row.version + 1 })
      .where(and(eq(reimbursements.id, reimbursementId), eq(reimbursements.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This claim was changed by someone else. Reload and try again.");
    }

    await tx.insert(reimbursementEvents).values({
      reimbursementId,
      householdId,
      type: "STATUS_CHANGED",
      summary: result.transition.timelineSummary,
      metadata: { from: row.status, to: result.transition.status },
      actorUserId: actor.userId,
    });

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: result.transition.auditAction,
        resourceType: "reimbursement",
        resourceId: reimbursementId,
        // States, never amounts — the same rule as expense.recorded.
        metadata: { from: row.status, to: result.transition.status },
      },
      tx
    );

    return updated[0];
  });
}

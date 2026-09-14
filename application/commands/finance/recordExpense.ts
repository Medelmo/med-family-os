import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { expenses } from "../../../db/schema";
import { EXPENSE_CATEGORIES } from "../../../domain/finance/expense";
import { DEFAULT_CURRENCY, parseAmountToMinor } from "../../../domain/finance/money";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeExpenseAccess } from "../../policies/finance";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class InvalidAmountError extends Error {
  readonly code = "AMOUNT_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

const recordExpenseSchema = z.object({
  description: z.string().trim().min(1).max(300),
  /**
   * Text, not a number. The form sends what the user typed and the domain
   * parser decides what it means, so the single documented parsing rule in
   * domain/finance/money.ts applies to a typed expense and an imported CSV
   * row alike — rather than the browser's number input deciding one of
   * them and the parser the other.
   */
  amount: z.string().trim().min(1).max(30),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
    .default(DEFAULT_CURRENCY),
  category: z.enum(EXPENSE_CATEGORIES).default("OTHER"),
  incurredOn: isoDate,
  personId: z.string().uuid().nullish(),
  paidByPersonId: z.string().uuid().nullish(),
  merchant: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type RecordExpenseInput = z.input<typeof recordExpenseSchema>;

/**
 * Records a spend.
 *
 * Negative amounts are refused rather than stored as a "refund": a refund
 * is a different event with different meaning, and allowing a sign flip
 * here would make every category total quietly depend on whether someone
 * typed a minus. Sensitivity and visibility are not accepted from the
 * caller — they come from the domain defaults (ADR-015 §4), so no call
 * site can create a household expense a child account can read.
 */
export async function recordExpense(actor: Actor, householdId: string, input: RecordExpenseInput) {
  const parsed = recordExpenseSchema.parse(input);

  const amount = parseAmountToMinor(parsed.amount, parsed.currency);
  if (!amount.ok) throw new InvalidAmountError(`That amount could not be read (${amount.reason}).`);
  if (amount.amountMinor <= 0) throw new InvalidAmountError("An expense must be a positive amount.");

  const personScopeIds = parsed.personId ? [parsed.personId] : [];

  const authorized = authorizeExpenseAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "SENSITIVE",
    createdBy: actor.userId,
    personScopeIds,
  });
  if (!authorized) throw new AuthorizationError("Not permitted to record an expense in this household.");

  return db.transaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        householdId,
        description: parsed.description,
        category: parsed.category,
        currency: parsed.currency,
        amountMinor: amount.amountMinor,
        incurredOn: parsed.incurredOn,
        personId: parsed.personId ?? null,
        paidByPersonId: parsed.paidByPersonId ?? null,
        merchant: parsed.merchant ?? null,
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "expense.recorded",
        resourceType: "expense",
        resourceId: expense.id,
        // Deliberately no amount, description or merchant. CLAUDE.md §12
        // requires audit logging and forbids sensitive data in logs; "an
        // expense was recorded, by whom, when" is the security-relevant
        // fact, and the amount is exactly what must not leak into a log
        // that is read by people who cannot open the record itself.
        metadata: { category: parsed.category, currency: parsed.currency },
      },
      tx
    );

    return expense;
  });
}

/**
 * Archives an expense rather than deleting it (CLAUDE.md §6: "Prefer
 * archive over destructive deletion for operational records"). An archived
 * expense stops counting towards budgets but stays in the record, so a
 * household can undo a mistake without the month's totals silently
 * changing under them a second time.
 */
export async function archiveExpense(
  actor: Actor,
  householdId: string,
  expenseId: string,
  expectedVersion: number,
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, expenseId), eq(expenses.householdId, householdId)))
      .limit(1);

    if (!row) throw new NotFoundError("Expense not found.");

    const authorized = authorizeExpenseAccess(actor, "delete", {
      householdId: row.householdId,
      visibility: row.visibility,
      sensitivity: row.sensitivity,
      createdBy: row.createdBy,
      personScopeIds: row.personId ? [row.personId] : [],
    });
    if (!authorized) throw new AuthorizationError("Not permitted to archive this expense.");

    const updated = await tx
      .update(expenses)
      .set({ archivedAt: now, updatedAt: now, version: row.version + 1 })
      .where(and(eq(expenses.id, expenseId), eq(expenses.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This expense was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "expense.archived",
        resourceType: "expense",
        resourceId: expenseId,
      },
      tx
    );

    return updated[0];
  });
}

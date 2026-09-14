import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { expenses } from "../../../db/schema";
import {
  duplicateKey,
  planExpenseImport,
  type ImportPlan,
  type PlannedRow,
} from "../../../domain/finance/expenseImport";
import { DEFAULT_CURRENCY } from "../../../domain/finance/money";
import {
  DEFAULT_EXPENSE_SENSITIVITY,
  DEFAULT_EXPENSE_VISIBILITY,
} from "../../../domain/finance/expense";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeExpenseAccess } from "../../policies/finance";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

/** 1 MiB. A household's yearly export is a few tens of kilobytes. */
export const IMPORT_MAX_BYTES = 1024 * 1024;

function assertMayImport(actor: Actor, householdId: string) {
  const allowed = authorizeExpenseAccess(actor, "create", {
    householdId,
    visibility: DEFAULT_EXPENSE_VISIBILITY,
    sensitivity: DEFAULT_EXPENSE_SENSITIVITY,
    createdBy: actor.userId,
    personScopeIds: [],
  });
  if (!allowed) throw new AuthorizationError("Not permitted to import expenses into this household.");
}

/**
 * Reads the file and says what *would* happen. Writes nothing.
 *
 * Duplicate detection needs the household's existing rows, which is why
 * this lives in the application layer while the parsing rules stay pure in
 * domain/finance/expenseImport.ts.
 */
export async function previewExpenseImport(
  actor: Actor,
  householdId: string,
  text: string,
  defaultCurrency: string = DEFAULT_CURRENCY
): Promise<ImportPlan> {
  assertMayImport(actor, householdId);

  const existingRows = await db
    .select({
      incurredOn: expenses.incurredOn,
      description: expenses.description,
      amountMinor: expenses.amountMinor,
      currency: expenses.currency,
    })
    .from(expenses)
    .where(and(eq(expenses.householdId, householdId), isNull(expenses.archivedAt)));

  const existing = new Set(existingRows.map(duplicateKey));

  return planExpenseImport(text, { defaultCurrency, existing });
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Writes the importable rows of the *same text* the household reviewed.
 *
 * The text is re-planned here rather than the reviewed rows being carried
 * over from the preview. `planExpenseImport` is pure and deterministic, so
 * re-running it on the same input cannot produce a different answer — and
 * that removes the failure mode where a preview shows one set of amounts
 * and the write stores another. It also means nothing has to trust a
 * structure that travelled through the browser.
 *
 * Duplicates are imported. They are flagged in the preview so the decision
 * is the household's; re-importing a file on purpose is legitimate, and
 * refusing it would make a genuine second identical expense — two coffees
 * on the same day — impossible to record.
 *
 * One transaction: a partial import that half-happened is much harder to
 * reason about than one that did not happen at all.
 */
export async function importExpenses(
  actor: Actor,
  householdId: string,
  text: string,
  defaultCurrency: string = DEFAULT_CURRENCY
): Promise<ImportResult> {
  assertMayImport(actor, householdId);

  const plan = planExpenseImport(text, { defaultCurrency });
  if (!plan.ok) return { imported: 0, skipped: 0 };

  const importable = plan.rows.filter((row) => row.problems.length === 0);
  if (importable.length === 0) return { imported: 0, skipped: plan.rows.length };

  return db.transaction(async (tx) => {
    await tx.insert(expenses).values(importable.map((row) => toInsert(row, householdId, actor)));

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "expense.imported",
        resourceType: "expense",
        // A batch has no single resource id, so the id is left out. The
        // counts are the useful fact and, unlike the rows themselves, are
        // not sensitive.
        metadata: { imported: importable.length, skipped: plan.rows.length - importable.length },
      },
      tx
    );

    return { imported: importable.length, skipped: plan.rows.length - importable.length };
  });
}

function toInsert(row: PlannedRow, householdId: string, actor: Actor) {
  return {
    householdId,
    description: row.description,
    category: row.category,
    currency: row.currency,
    amountMinor: row.amountMinor,
    incurredOn: row.incurredOn,
    merchant: row.merchant,
    // Sensitivity and visibility come from the domain defaults, exactly as
    // they do for a typed expense — an imported row must not be able to
    // arrive less protected than one entered by hand.
    createdBy: actor.userId,
  };
}

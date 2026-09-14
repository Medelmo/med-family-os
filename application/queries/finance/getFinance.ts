import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { budgets, expenses, people, reimbursementEvents, reimbursements } from "../../../db/schema";
import {
  projectBudgets,
  type Budget,
  type BudgetStatus,
  type CategorySpend,
} from "../../../domain/finance/budget";
import type { ExpenseCategory } from "../../../domain/finance/expense";
import { toCsv } from "../../../domain/finance/csv";
import { EXPORT_HEADER } from "../../../domain/finance/expenseImport";
import { formatMinorAsDecimal } from "../../../domain/finance/money";
import {
  OPEN_REIMBURSEMENT_STATUSES,
  outstandingMinor,
  type ReimbursementStatus,
} from "../../../domain/finance/reimbursement";
import { authorizeBudgetAccess, authorizeExpenseAccess, authorizeReimbursementAccess } from "../../policies/finance";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, NotFoundError } from "../../errors";

export interface ExpenseListItem {
  id: string;
  description: string;
  category: ExpenseCategory;
  currency: string;
  amountMinor: number;
  incurredOn: string;
  merchant: string | null;
  personName: string | null;
  reimbursementId: string | null;
  version: number;
}

/** First and last day of a "YYYY-MM" month, inclusive. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Expenses in one month the actor may see.
 *
 * Same approach as getTasks/getCases: the household and date filters bound
 * the set, then the row-level policy decides. Duplicating the policy into a
 * WHERE clause would give it a second home to drift in — and here the
 * consequence of drift is a child account seeing the household's spending.
 */
export async function getExpensesForMonth(
  actor: Actor,
  householdId: string,
  month: string,
  limit = 500
): Promise<ExpenseListItem[]> {
  const { from, to } = monthBounds(month);

  const rows = await db
    .select({ expense: expenses, personName: people.displayName })
    .from(expenses)
    .leftJoin(people, eq(people.id, expenses.personId))
    .where(
      and(
        eq(expenses.householdId, householdId),
        isNull(expenses.archivedAt),
        gte(expenses.incurredOn, from),
        lte(expenses.incurredOn, to)
      )
    )
    .orderBy(desc(expenses.incurredOn), desc(expenses.createdAt))
    .limit(limit);

  return rows
    .filter(({ expense }) =>
      authorizeExpenseAccess(actor, "read", {
        householdId: expense.householdId,
        visibility: expense.visibility,
        sensitivity: expense.sensitivity,
        createdBy: expense.createdBy,
        personScopeIds: expense.personId ? [expense.personId] : [],
      })
    )
    .map(({ expense, personName }) => ({
      id: expense.id,
      description: expense.description,
      category: expense.category,
      currency: expense.currency,
      amountMinor: expense.amountMinor,
      incurredOn: expense.incurredOn,
      merchant: expense.merchant,
      personName,
      reimbursementId: expense.reimbursementId,
      version: expense.version,
    }));
}

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
}

export interface FinanceOverview {
  month: string;
  budgets: BudgetStatus[];
  totals: CurrencyTotal[];
  expenses: ExpenseListItem[];
  /** Currencies present in the month's spend that no envelope covers. */
  uncoveredCurrencies: string[];
}

/**
 * The finance page's single authorized read.
 *
 * Budget spend is summed from the *authorized* expense list rather than in
 * SQL. That is deliberate and costs a little accuracy in exchange for a
 * property that matters more: the totals a user sees always add up to the
 * rows they can see. Summing in SQL would show a CHILD or a scoped ADULT a
 * category total that includes expenses the same page refuses to list,
 * which is a disclosure by arithmetic — the reader can subtract.
 */
export async function getFinanceOverview(
  actor: Actor,
  householdId: string,
  month: string
): Promise<FinanceOverview> {
  const visibleExpenses = await getExpensesForMonth(actor, householdId, month);

  const canSeeBudgets = authorizeBudgetAccess(actor, "read", { householdId });
  const budgetRows = canSeeBudgets
    ? await db.select().from(budgets).where(eq(budgets.householdId, householdId)).orderBy(asc(budgets.category))
    : [];

  const spendByKey = new Map<string, CategorySpend>();
  const totalsByCurrency = new Map<string, number>();

  for (const expense of visibleExpenses) {
    const key = `${expense.category}:${expense.currency}`;
    const existing = spendByKey.get(key);
    if (existing) existing.spentMinor += expense.amountMinor;
    else
      spendByKey.set(key, {
        category: expense.category,
        currency: expense.currency,
        spentMinor: expense.amountMinor,
      });

    totalsByCurrency.set(expense.currency, (totalsByCurrency.get(expense.currency) ?? 0) + expense.amountMinor);
  }

  const budgetStatuses = projectBudgets(budgetRows as unknown as Budget[], [...spendByKey.values()], month);

  // Currencies the envelopes say nothing about. Reported rather than
  // converted (ADR-015 §5) so the page can say so out loud instead of
  // quietly leaving money out of the totals.
  const coveredCurrencies = new Set(budgetStatuses.map((status) => status.currency));
  const uncoveredCurrencies = [...totalsByCurrency.keys()]
    .filter((currency) => budgetRows.length > 0 && !coveredCurrencies.has(currency))
    .sort();

  return {
    month,
    budgets: budgetStatuses,
    totals: [...totalsByCurrency.entries()]
      .map(([currency, totalMinor]) => ({ currency, totalMinor }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    expenses: visibleExpenses,
    uncoveredCurrencies,
  };
}

export interface ReimbursementListItem {
  id: string;
  title: string;
  status: ReimbursementStatus;
  counterparty: string | null;
  externalReference: string | null;
  currency: string;
  claimedAmountMinor: number;
  reimbursedAmountMinor: number;
  outstandingMinor: number;
  waitingSince: Date | null;
  followUpAt: Date | null;
  waitingNoFollowUpReason: string | null;
  rejectionReason: string | null;
  version: number;
}

function toClaimListItem(row: typeof reimbursements.$inferSelect): ReimbursementListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    counterparty: row.counterparty,
    externalReference: row.externalReference,
    currency: row.currency,
    claimedAmountMinor: row.claimedAmountMinor,
    reimbursedAmountMinor: row.reimbursedAmountMinor,
    outstandingMinor: outstandingMinor(row),
    waitingSince: row.waitingSince,
    followUpAt: row.followUpAt,
    waitingNoFollowUpReason: row.waitingNoFollowUpReason,
    rejectionReason: row.rejectionReason,
    version: row.version,
  };
}

export async function getReimbursements(
  actor: Actor,
  householdId: string,
  options: { statuses?: readonly ReimbursementStatus[]; limit?: number } = {}
): Promise<ReimbursementListItem[]> {
  const statuses = options.statuses ?? OPEN_REIMBURSEMENT_STATUSES;

  const rows = await db
    .select()
    .from(reimbursements)
    .where(and(eq(reimbursements.householdId, householdId), inArray(reimbursements.status, [...statuses])))
    .orderBy(asc(reimbursements.followUpAt), desc(reimbursements.createdAt))
    .limit(options.limit ?? 200);

  return rows
    .filter((row) =>
      authorizeReimbursementAccess(actor, "read", {
        householdId: row.householdId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
        createdBy: row.createdBy,
        personScopeIds: [],
      })
    )
    .map(toClaimListItem);
}

export interface ReimbursementDetail extends ReimbursementListItem {
  notes: string | null;
  expenses: ExpenseListItem[];
  timeline: { id: string; type: string; summary: string; createdAt: Date }[];
}

export async function getReimbursement(
  actor: Actor,
  householdId: string,
  reimbursementId: string
): Promise<ReimbursementDetail> {
  const [row] = await db
    .select()
    .from(reimbursements)
    .where(and(eq(reimbursements.id, reimbursementId), eq(reimbursements.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Claim not found.");

  const authorized = authorizeReimbursementAccess(actor, "read", {
    householdId: row.householdId,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    createdBy: row.createdBy,
    personScopeIds: [],
  });
  if (!authorized) throw new AuthorizationError("Not permitted to view this claim.");

  const [expenseRows, timelineRows] = await Promise.all([
    db
      .select({ expense: expenses, personName: people.displayName })
      .from(expenses)
      .leftJoin(people, eq(people.id, expenses.personId))
      .where(eq(expenses.reimbursementId, reimbursementId))
      .orderBy(desc(expenses.incurredOn)),
    db
      .select()
      .from(reimbursementEvents)
      .where(eq(reimbursementEvents.reimbursementId, reimbursementId))
      .orderBy(desc(reimbursementEvents.createdAt))
      .limit(100),
  ]);

  return {
    ...toClaimListItem(row),
    notes: row.notes,
    expenses: expenseRows
      .filter(({ expense }) =>
        authorizeExpenseAccess(actor, "read", {
          householdId: expense.householdId,
          visibility: expense.visibility,
          sensitivity: expense.sensitivity,
          createdBy: expense.createdBy,
          personScopeIds: expense.personId ? [expense.personId] : [],
        })
      )
      .map(({ expense, personName }) => ({
        id: expense.id,
        description: expense.description,
        category: expense.category,
        currency: expense.currency,
        amountMinor: expense.amountMinor,
        incurredOn: expense.incurredOn,
        merchant: expense.merchant,
        personName,
        reimbursementId: expense.reimbursementId,
        version: expense.version,
      })),
    timeline: timelineRows.map((e) => ({ id: e.id, type: e.type, summary: e.summary, createdAt: e.createdAt })),
  };
}

/**
 * A month's expenses as CSV, built only from rows the actor may read.
 *
 * It goes through `getExpensesForMonth`, so the export can never contain
 * something the page would refuse to show — an export that quietly widened
 * access would be the most damaging possible version of that bug, because
 * the file then leaves the application entirely.
 *
 * `toCsv` neutralises cells a spreadsheet would execute as a formula; see
 * domain/finance/csv.ts. That matters most here, on the way out.
 */
export async function exportExpensesCsv(actor: Actor, householdId: string, month: string): Promise<string> {
  const rows = await getExpensesForMonth(actor, householdId, month);

  return toCsv([
    [...EXPORT_HEADER],
    ...rows.map((expense) => [
      expense.incurredOn,
      expense.description,
      // The machine-readable decimal, not a localised string: this file is
      // meant to be re-importable, and the importer's own rule is what
      // reads it back.
      formatMinorAsDecimal(expense.amountMinor, expense.currency),
      expense.currency,
      expense.category,
      expense.merchant ?? "",
    ]),
  ]);
}

/** Unclaimed, unarchived expenses — the candidates for a new claim. */
export async function getClaimableExpenses(
  actor: Actor,
  householdId: string,
  limit = 100
): Promise<ExpenseListItem[]> {
  const rows = await db
    .select({ expense: expenses, personName: people.displayName })
    .from(expenses)
    .leftJoin(people, eq(people.id, expenses.personId))
    .where(
      and(
        eq(expenses.householdId, householdId),
        isNull(expenses.archivedAt),
        isNull(expenses.reimbursementId)
      )
    )
    .orderBy(desc(expenses.incurredOn))
    .limit(limit);

  return rows
    .filter(({ expense }) =>
      authorizeExpenseAccess(actor, "read", {
        householdId: expense.householdId,
        visibility: expense.visibility,
        sensitivity: expense.sensitivity,
        createdBy: expense.createdBy,
        personScopeIds: expense.personId ? [expense.personId] : [],
      })
    )
    .map(({ expense, personName }) => ({
      id: expense.id,
      description: expense.description,
      category: expense.category,
      currency: expense.currency,
      amountMinor: expense.amountMinor,
      incurredOn: expense.incurredOn,
      merchant: expense.merchant,
      personName,
      reimbursementId: expense.reimbursementId,
      version: expense.version,
    }));
}

import type { ExpenseCategory } from "./expense";

/**
 * docs/domain/domain-model.md: "A planning envelope, not a bank ledger."
 *
 * Modelled as a *recurring monthly* envelope per category rather than one
 * row per category per month. A row per month would need something to
 * create next month's rows — a job that can fail, run twice, or run for a
 * household that stopped using budgets — and would make "what is the limit
 * for March?" depend on whether that job had run yet. A recurring envelope
 * with an optional end date answers that question from data that already
 * exists, for any month, past or future.
 *
 * Consequence, stated plainly: changing a limit changes it for every month
 * the envelope still covers, including months already past. If a household
 * later needs "the limit was 400 until June and 450 after", that is
 * expressed by ending one envelope and starting another — which is why
 * `startsOn`/`endsOn` exist rather than a bare limit.
 */
export interface Budget {
  id: string;
  householdId: string;
  category: ExpenseCategory;
  currency: string;
  monthlyLimitMinor: number;
  /** "YYYY-MM-DD"; the envelope applies to months on or after this date's month. */
  startsOn: string;
  /** "YYYY-MM-DD" or null for open-ended; the last month covered is this date's month. */
  endsOn: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** "YYYY-MM". */
export type BudgetMonth = string;

export function monthOf(isoDate: string): BudgetMonth {
  return isoDate.slice(0, 7);
}

export function coversMonth(budget: Pick<Budget, "startsOn" | "endsOn">, month: BudgetMonth): boolean {
  if (monthOf(budget.startsOn) > month) return false;
  if (budget.endsOn && monthOf(budget.endsOn) < month) return false;
  return true;
}

/**
 * How a category is doing against its envelope.
 *
 * `OVER` and `NEAR` are computed here rather than in the UI so that the
 * Attention rules, the finance page and any future export all agree on
 * when a budget is in trouble.
 */
export type BudgetHealth = "UNDER" | "NEAR" | "OVER";

export interface BudgetStatus {
  category: ExpenseCategory;
  currency: string;
  limitMinor: number;
  spentMinor: number;
  /** Negative once the envelope is exceeded. */
  remainingMinor: number;
  /** 0-based fraction; 1.2 means 20% over. Infinity is impossible — a zero limit is rejected on write. */
  usedFraction: number;
  health: BudgetHealth;
}

/** Spend at or above this fraction of the envelope counts as NEAR. */
export const NEAR_LIMIT_FRACTION = 0.85;

export interface CategorySpend {
  category: ExpenseCategory;
  currency: string;
  spentMinor: number;
}

/**
 * Pure projection: envelopes plus spend for one month, in one currency.
 *
 * Multi-currency is handled by *not* handling it — amounts in a currency
 * other than the budget's are excluded and reported separately by the
 * caller, rather than converted. Converting would require a rate this app
 * cannot verify, and a budget quietly inflated by yesterday's exchange
 * rate is worse than one that says "3 expenses in USD are not counted
 * here".
 */
export function projectBudgets(
  budgets: readonly Budget[],
  spend: readonly CategorySpend[],
  month: BudgetMonth
): BudgetStatus[] {
  const applicable = budgets.filter((budget) => coversMonth(budget, month));

  return applicable
    .map((budget) => {
      const spentMinor = spend
        .filter((entry) => entry.category === budget.category && entry.currency === budget.currency)
        .reduce((total, entry) => total + entry.spentMinor, 0);

      const usedFraction = budget.monthlyLimitMinor > 0 ? spentMinor / budget.monthlyLimitMinor : 0;

      return {
        category: budget.category,
        currency: budget.currency,
        limitMinor: budget.monthlyLimitMinor,
        spentMinor,
        remainingMinor: budget.monthlyLimitMinor - spentMinor,
        usedFraction,
        health: healthFor(usedFraction),
      };
    })
    .sort((a, b) => b.usedFraction - a.usedFraction || a.category.localeCompare(b.category));
}

function healthFor(usedFraction: number): BudgetHealth {
  if (usedFraction > 1) return "OVER";
  if (usedFraction >= NEAR_LIMIT_FRACTION) return "NEAR";
  return "UNDER";
}

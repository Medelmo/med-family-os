import type { Sensitivity, Visibility } from "../shared/types";

/**
 * A fixed starter set rather than free text.
 *
 * Free-text categories cannot be budgeted against or reported on without
 * first solving "Groceries" vs "groceries" vs "Food", and every household
 * finance tool that starts free-form ends up retrofitting a canonical list
 * anyway. A fixed list is also translatable (CLAUDE.md §14), which a
 * user-typed string is not.
 *
 * The cost is that it will not fit every household exactly. That is the
 * reversible half of the trade: user-defined categories can be added later
 * as rows that these values seed, whereas un-picking free text afterwards
 * means guessing at the household's own historical data. ADR-015.
 */
export const EXPENSE_CATEGORIES = [
  "HOUSING",
  "UTILITIES",
  "GROCERIES",
  "HEALTH",
  "INSURANCE",
  "TRANSPORT",
  "CHILDCARE",
  "EDUCATION",
  "LEISURE",
  "TRAVEL",
  "HOUSEHOLD",
  "FEES",
  "OTHER",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * docs/domain/domain-model.md: "A financial occurrence."
 *
 * Note what is absent: no account, no balance, no running total, no
 * reconciliation state. product-spec.md lists "banking replacement" as an
 * anti-goal, and CLAUDE.md §0 puts the ledger outside this app entirely.
 * An expense here exists to be budgeted against, reimbursed, and attached
 * to a case — not to make the bank statement agree.
 *
 * `incurredOn` is a date, not an instant: an expense happens on a day, and
 * storing a timestamp would invite timezone drift into a value that has no
 * time-of-day meaning (CLAUDE.md §7).
 */
export interface Expense {
  id: string;
  householdId: string;
  description: string;
  category: ExpenseCategory;
  currency: string;
  amountMinor: number;
  /** "YYYY-MM-DD" in the household's timezone. */
  incurredOn: string;
  /** Which household member the spend is about, for person-scoped authorization. */
  personId: string | null;
  /** Who paid, when that differs from who recorded it. */
  paidByPersonId: string | null;
  merchant: string | null;
  notes: string | null;
  /** Set when this expense is part of a claim. */
  reimbursementId: string | null;
  archivedAt: Date | null;

  visibility: Visibility;
  sensitivity: Sensitivity;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Expenses default to SENSITIVE, unlike every other aggregate in the app.
 *
 * CLAUDE.md §5 makes children "highly restricted ... never inherit adult
 * access", and the policy kernel already refuses a CHILD any resource above
 * NORMAL sensitivity. Household spending is exactly the category §10 names
 * when it forbids exposing "detailed financial transactions" even to Home
 * Assistant. Defaulting to NORMAL and relying on each caller to raise it
 * would mean one forgotten field makes the household's finances readable by
 * a child account — a default that fails open, which is the bug class this
 * project has already been bitten by once.
 */
export const DEFAULT_EXPENSE_SENSITIVITY: Sensitivity = "SENSITIVE";
export const DEFAULT_EXPENSE_VISIBILITY: Visibility = "HOUSEHOLD";

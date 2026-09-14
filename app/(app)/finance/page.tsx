import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getFinanceOverview } from "../../../application/queries/finance/getFinance";
import { getHouseholdMembers } from "../../../application/queries/household/getHouseholdMembers";
import { getHouseholdTimezone } from "../../../application/queries/tasks/getTasks";
import { householdToday } from "../../../application/time";
import {
  DEFAULT_EXPENSE_SENSITIVITY,
  DEFAULT_EXPENSE_VISIBILITY,
  EXPENSE_CATEGORIES,
} from "../../../domain/finance/expense";
import { authorizeExpenseAccess } from "../../../application/policies/finance";
import { Card } from "../../../components/ui/Card";
import { Money } from "../../../components/ui/Money";
import { BudgetForm, RecordExpenseForm } from "./FinanceClient";
import styles from "./finance.module.css";

/**
 * The month a URL asks for, or the household's current one.
 *
 * A URL parameter is untrusted input even when it only picks a month: it
 * reaches a SQL date comparison, so it is matched against a strict shape
 * and otherwise ignored rather than passed through and hoped about.
 */
function resolveMonth(requested: string | undefined, fallback: string): string {
  if (!requested || !/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) return fallback;
  return requested;
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("finance");
  const tCategories = await getTranslations("finance.categories");

  const timezone = await getHouseholdTimezone(householdId);
  const today = householdToday(timezone);
  const month = resolveMonth((await searchParams).month, today.slice(0, 7));

  // Whether the forms are rendered at all is decided here, on the server,
  // from the same policy the commands enforce. This is presentation, not
  // authorization — a VIEWER who posted the form anyway would still be
  // refused by recordExpense — but showing someone a form that can only
  // fail is its own kind of broken.
  const canRecord = authorizeExpenseAccess(actor, "create", {
    householdId,
    visibility: DEFAULT_EXPENSE_VISIBILITY,
    sensitivity: DEFAULT_EXPENSE_SENSITIVITY,
    createdBy: actor.userId,
    personScopeIds: [],
  });

  const [overview, members] = await Promise.all([
    getFinanceOverview(actor, householdId, month),
    canRecord ? getHouseholdMembers(actor, householdId) : Promise.resolve([]),
  ]);

  const categoryOptions = EXPENSE_CATEGORIES.map((category) => ({
    value: category,
    label: tCategories(category),
  }));

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      <nav className={styles.monthNav} aria-label={t("monthNavLabel")}>
        <Link href={`/finance?month=${shiftMonth(month, -1)}`} rel="prev">
          {t("previousMonth")}
        </Link>
        <h2 className={styles.month}>{month}</h2>
        <Link href={`/finance?month=${shiftMonth(month, 1)}`} rel="next">
          {t("nextMonth")}
        </Link>
      </nav>

      <Card>
        <h2 className={styles.subtitle}>{t("spentThisMonth")}</h2>
        {overview.totals.length === 0 ? (
          <p className={styles.empty}>{t("noSpend")}</p>
        ) : (
          <ul className={styles.totals}>
            {overview.totals.map((total) => (
              <li key={total.currency} className={styles.total}>
                <Money amountMinor={total.totalMinor} currency={total.currency} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="budgets-heading">
        <h2 id="budgets-heading" className={styles.subtitle}>
          {t("budgets")}
        </h2>
        {overview.budgets.length === 0 ? (
          <Card>
            <p className={styles.empty}>{t("noBudgets")}</p>
          </Card>
        ) : (
          <ul className={styles.list}>
            {overview.budgets.map((budget) => (
              <li key={`${budget.category}:${budget.currency}`}>
                <Card className={styles.budget}>
                  <div className={styles.budgetHeader}>
                    <h3 className={styles.budgetCategory}>{tCategories(budget.category)}</h3>
                    {/* The state is spelled out, never colour alone
                        (CLAUDE.md §13). */}
                    <span className={styles.health} data-health={budget.health}>
                      {t(`health.${budget.health}`)}
                    </span>
                  </div>
                  <p className={styles.budgetFigures}>
                    <Money amountMinor={budget.spentMinor} currency={budget.currency} />
                    {" / "}
                    <Money amountMinor={budget.limitMinor} currency={budget.currency} />
                  </p>
                  <p className={styles.meta}>
                    {budget.remainingMinor >= 0
                      ? t.rich("remaining", {
                          amount: () => <Money amountMinor={budget.remainingMinor} currency={budget.currency} />,
                        })
                      : t.rich("overBy", {
                          amount: () => (
                            <Money amountMinor={-budget.remainingMinor} currency={budget.currency} signed />
                          ),
                        })}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {overview.uncoveredCurrencies.length > 0 && (
          // Said out loud rather than silently folded in at a rate this
          // app cannot verify (ADR-015 §5).
          <p className={styles.notice}>
            {t("uncoveredCurrencies", { currencies: overview.uncoveredCurrencies.join(", ") })}
          </p>
        )}
      </section>

      <section aria-labelledby="expenses-heading">
        <h2 id="expenses-heading" className={styles.subtitle}>
          {t("expenses")}
        </h2>
        {overview.expenses.length === 0 ? (
          <Card>
            <p className={styles.empty}>{t("noExpenses")}</p>
          </Card>
        ) : (
          <Card>
            <table className={styles.table}>
              <caption className={styles.tableCaption}>{t("expensesCaption", { month })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("columnDate")}</th>
                  <th scope="col">{t("columnDescription")}</th>
                  <th scope="col">{t("columnCategory")}</th>
                  <th scope="col" className={styles.numeric}>
                    {t("columnAmount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{expense.incurredOn}</td>
                    <td>
                      {expense.description}
                      {expense.reimbursementId && (
                        <span className={styles.tag}>
                          <Link href={`/finance/claims/${expense.reimbursementId}`}>{t("onAClaim")}</Link>
                        </span>
                      )}
                    </td>
                    <td>{tCategories(expense.category)}</td>
                    <td className={styles.numeric}>
                      <Money amountMinor={expense.amountMinor} currency={expense.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <p>
        <Link href="/finance/claims">{t("goToClaims")}</Link>
      </p>

      {canRecord && (
        <>
          <RecordExpenseForm
            categories={categoryOptions}
            today={today}
            people={members.map((member) => ({ id: member.personId, name: member.displayName }))}
          />
          <BudgetForm categories={categoryOptions} today={today} />
        </>
      )}
    </div>
  );
}

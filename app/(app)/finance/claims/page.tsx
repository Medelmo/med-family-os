import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { getClaimableExpenses, getReimbursements } from "../../../../application/queries/finance/getFinance";
import { authorizeReimbursementAccess } from "../../../../application/policies/finance";
import { DEFAULT_EXPENSE_SENSITIVITY, DEFAULT_EXPENSE_VISIBILITY } from "../../../../domain/finance/expense";
import { formatMinorAsDecimal } from "../../../../domain/finance/money";
import { Card } from "../../../../components/ui/Card";
import { Money } from "../../../../components/ui/Money";
import { OpenClaimForm } from "../FinanceClient";
import styles from "../finance.module.css";

export default async function ClaimsPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("finance");

  const canOpen = authorizeReimbursementAccess(actor, "create", {
    householdId,
    visibility: DEFAULT_EXPENSE_VISIBILITY,
    sensitivity: DEFAULT_EXPENSE_SENSITIVITY,
    createdBy: actor.userId,
    personScopeIds: [],
  });

  const [claims, claimable] = await Promise.all([
    getReimbursements(actor, householdId),
    canOpen ? getClaimableExpenses(actor, householdId) : Promise.resolve([]),
  ]);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("claimsTitle")}</h1>
        <p className={styles.description}>{t("claimsDescription")}</p>
      </header>

      {claims.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("noClaims")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {claims.map((claim) => (
            <li key={claim.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <h2 className={styles.itemTitle}>
                    <Link href={`/finance/claims/${claim.id}`}>{claim.title}</Link>
                  </h2>
                  <span className={styles.status} data-status={claim.status}>
                    {t(`claimStatus.${claim.status}`)}
                  </span>
                </div>

                <p className={styles.budgetFigures}>
                  {t.rich("outstandingOf", {
                    outstanding: () => <Money amountMinor={claim.outstandingMinor} currency={claim.currency} />,
                    claimed: () => <Money amountMinor={claim.claimedAmountMinor} currency={claim.currency} />,
                  })}
                </p>

                {claim.counterparty && <p className={styles.meta}>{t("withWhom", { who: claim.counterparty })}</p>}
                {claim.status === "WAITING" && claim.waitingNoFollowUpReason && (
                  <p className={styles.meta}>{t("waitingOpenEnded", { reason: claim.waitingNoFollowUpReason })}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p>
        <Link href="/finance">{t("backToFinance")}</Link>
      </p>

      {canOpen && (
        <OpenClaimForm
          claimable={claimable.map((expense) => ({
            id: expense.id,
            // Formatted plainly rather than through <Money>: this is a
            // checkbox label inside a client form, and a machine-readable
            // decimal keeps the option stable for tests and screen readers.
            label: `${expense.incurredOn} · ${expense.description} · ${formatMinorAsDecimal(expense.amountMinor, expense.currency)} ${expense.currency}`,
          }))}
        />
      )}
    </div>
  );
}

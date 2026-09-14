import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../../../infrastructure/auth/currentActor";
import { getReimbursement } from "../../../../../application/queries/finance/getFinance";
import { NotFoundError } from "../../../../../application/errors";
import type { ReimbursementStatus } from "../../../../../domain/finance/reimbursement";
import { Card } from "../../../../../components/ui/Card";
import { Money } from "../../../../../components/ui/Money";
import { ClaimActionForm } from "../../FinanceClient";
import styles from "../../finance.module.css";

interface ActionSpec {
  action: string;
  labelKey: string;
  fields?: { name: string; labelKey: string; type?: string; required?: boolean; hintKey?: string }[];
}

/**
 * Which actions a claim offers, derived from its status.
 *
 * This mirrors ALLOWED_TRANSITIONS in domain/finance/reimbursement.ts so a
 * dead end is never presented — but it is not the enforcement. The domain
 * refuses an illegal transition regardless of what was rendered, which is
 * the rule CLAUDE.md §6 states as "never trust client-side hiding as
 * authorization".
 */
const ACTIONS_BY_STATUS: Record<ReimbursementStatus, ActionSpec[]> = {
  PLANNED: [
    {
      action: "submit",
      labelKey: "actionSubmit",
      fields: [
        { name: "counterparty", labelKey: "counterpartyLabel", required: true },
        { name: "externalReference", labelKey: "referenceLabel" },
      ],
    },
    { action: "cancel", labelKey: "actionCancel", fields: [{ name: "reason", labelKey: "reasonLabel" }] },
  ],
  SUBMITTED: [
    {
      action: "wait",
      labelKey: "actionWait",
      fields: [
        { name: "followUpAt", labelKey: "followUpLabel", type: "date" },
        { name: "noFollowUpReason", labelKey: "noFollowUpLabel", hintKey: "noFollowUpHint" },
      ],
    },
    {
      action: "reject",
      labelKey: "actionReject",
      fields: [{ name: "reason", labelKey: "reasonLabel", required: true }],
    },
    { action: "cancel", labelKey: "actionCancel", fields: [{ name: "reason", labelKey: "reasonLabel" }] },
  ],
  WAITING: [
    { action: "approve", labelKey: "actionApprove", fields: [{ name: "amount", labelKey: "approvedAmountLabel" }] },
    {
      action: "reject",
      labelKey: "actionReject",
      fields: [{ name: "reason", labelKey: "reasonLabel", required: true }],
    },
    { action: "cancel", labelKey: "actionCancel", fields: [{ name: "reason", labelKey: "reasonLabel" }] },
  ],
  APPROVED: [
    {
      action: "full_payment",
      labelKey: "actionFullPayment",
      fields: [{ name: "amount", labelKey: "receivedAmountLabel", required: true }],
    },
    {
      action: "part_payment",
      labelKey: "actionPartPayment",
      fields: [{ name: "amount", labelKey: "receivedAmountLabel", required: true }],
    },
    { action: "cancel", labelKey: "actionCancel", fields: [{ name: "reason", labelKey: "reasonLabel" }] },
  ],
  PARTIALLY_REIMBURSED: [
    {
      action: "full_payment",
      labelKey: "actionFullPayment",
      fields: [{ name: "amount", labelKey: "receivedTotalLabel", required: true }],
    },
    { action: "cancel", labelKey: "actionCancel", fields: [{ name: "reason", labelKey: "reasonLabel" }] },
  ],
  PAID: [{ action: "complete", labelKey: "actionComplete" }],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export default async function ClaimDetailPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("finance");
  const tCategories = await getTranslations("finance.categories");
  const { claimId } = await params;

  let claim;
  try {
    claim = await getReimbursement(actor, householdId, claimId);
  } catch (error) {
    // A claim that does not exist is a 404. An AuthorizationError is
    // deliberately *not* caught here — it belongs to the error boundary,
    // so "you may not see this" and "this is not here" stay distinct for a
    // household whose members are all known to each other.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const actions = ACTIONS_BY_STATUS[claim.status];

  return (
    <div className={styles.page}>
      <p className={styles.breadcrumb}>
        <Link href="/finance/claims">{t("claimsTitle")}</Link>
      </p>

      <header>
        <h1 className={styles.title}>{claim.title}</h1>
        <p className={styles.status} data-status={claim.status}>
          {t(`claimStatus.${claim.status}`)}
        </p>
      </header>

      <Card>
        <dl className={styles.definitions}>
          <dt>{t("claimed")}</dt>
          <dd>
            <Money amountMinor={claim.claimedAmountMinor} currency={claim.currency} />
          </dd>
          <dt>{t("reimbursed")}</dt>
          <dd>
            <Money amountMinor={claim.reimbursedAmountMinor} currency={claim.currency} />
          </dd>
          <dt>{t("outstanding")}</dt>
          <dd>
            <Money amountMinor={claim.outstandingMinor} currency={claim.currency} />
          </dd>
          {claim.counterparty && (
            <>
              <dt>{t("counterpartyLabel")}</dt>
              <dd>{claim.counterparty}</dd>
            </>
          )}
          {claim.externalReference && (
            <>
              <dt>{t("referenceLabel")}</dt>
              <dd>{claim.externalReference}</dd>
            </>
          )}
          {claim.rejectionReason && (
            <>
              <dt>{t("rejectedBecause")}</dt>
              <dd>{claim.rejectionReason}</dd>
            </>
          )}
        </dl>
      </Card>

      <section aria-labelledby="claim-expenses-heading">
        <h2 id="claim-expenses-heading" className={styles.subtitle}>
          {t("attachedExpenses")}
        </h2>
        <Card>
          {claim.expenses.length === 0 ? (
            <p className={styles.empty}>{t("nothingAttached")}</p>
          ) : (
            <ul className={styles.plainList}>
              {claim.expenses.map((expense) => (
                <li key={expense.id} className={styles.expenseRow}>
                  <span>
                    {expense.incurredOn} · {expense.description} · {tCategories(expense.category)}
                  </span>
                  <Money amountMinor={expense.amountMinor} currency={expense.currency} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {actions.length > 0 && (
        <section aria-labelledby="claim-actions-heading">
          <h2 id="claim-actions-heading" className={styles.subtitle}>
            {t("whatNext")}
          </h2>
          <div className={styles.actions}>
            {actions.map((spec) => (
              <Card key={spec.action} className={styles.actionCard}>
                <ClaimActionForm
                  claimId={claim.id}
                  version={claim.version}
                  currency={claim.currency}
                  action={spec.action}
                  label={t(spec.labelKey)}
                  fields={spec.fields?.map((field) => ({
                    name: field.name,
                    label: t(field.labelKey),
                    type: field.type,
                    required: field.required,
                    hint: field.hintKey ? t(field.hintKey) : undefined,
                  }))}
                />
              </Card>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="claim-timeline-heading">
        <h2 id="claim-timeline-heading" className={styles.subtitle}>
          {t("timeline")}
        </h2>
        <Card>
          <ol className={styles.timeline}>
            {claim.timeline.map((entry) => (
              <li key={entry.id} className={styles.timelineEntry}>
                <time dateTime={entry.createdAt.toISOString()}>{entry.createdAt.toISOString().slice(0, 10)}</time>
                <span>{entry.summary}</span>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}

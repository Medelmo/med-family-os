"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  submitClaimTransition,
  submitCreateClaim,
  submitRecordExpense,
  submitSetBudget,
  type FinanceFormState,
} from "./actions";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { SelectField, type SelectOption } from "../../../components/ui/SelectField";
import { TextField } from "../../../components/ui/TextField";
import { useHydrated } from "../../../components/ui/useHydrated";
import styles from "./finance.module.css";

const EMPTY: FinanceFormState = {};

const ERROR_KEYS = {
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
  amount_invalid: "errorAmountInvalid",
  illegal_transition: "errorIllegalTransition",
  follow_up_required: "errorFollowUpRequired",
  counterparty_required: "errorCounterpartyRequired",
  rejection_reason_required: "errorRejectionReasonRequired",
  nothing_to_claim: "errorNothingToClaim",
  currency_mismatch: "errorCurrencyMismatch",
  already_claimed: "errorAlreadyClaimed",
  expense_archived: "errorExpenseArchived",
  claim_not_editable: "errorClaimNotEditable",
} as const;

function useFinanceError() {
  const t = useTranslations("finance");
  return (error?: string) => (error ? t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput") : null);
}

function ErrorLine({ error }: { error?: string }) {
  const message = useFinanceError()(error);
  if (!message) return null;
  return (
    <p role="alert" className={styles.error}>
      {message}
    </p>
  );
}

export function RecordExpenseForm({
  categories,
  today,
  people,
}: {
  categories: SelectOption[];
  today: string;
  people: { id: string; name: string }[];
}) {
  const t = useTranslations("finance");
  const [state, formAction, isPending] = useActionState(submitRecordExpense, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("recordExpense")}</h2>
      <form action={formAction} className={styles.form}>
        <TextField label={t("descriptionLabel")} name="description" required autoComplete="off" />
        {/* A text field, not type="number": the amount goes through the
            same documented parser as an imported CSV row (ADR-015 §2), so
            a German "12,34" is read the same way wherever it is typed.
            inputMode gets the numeric keypad on a phone regardless. */}
        <TextField
          label={t("amountLabel")}
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          hint={t("amountHint")}
        />
        <SelectField label={t("categoryLabel")} name="category" options={categories} defaultValue="OTHER" />
        <TextField label={t("dateLabel")} name="incurredOn" type="date" required defaultValue={today} />
        <TextField label={t("merchantLabel")} name="merchant" autoComplete="off" />
        {people.length > 0 && (
          <SelectField
            label={t("personLabel")}
            name="personId"
            options={[{ value: "", label: t("personNobody") }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
            defaultValue=""
          />
        )}
        <ErrorLine error={state.error} />
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("recordExpense")}
        </Button>
      </form>
    </Card>
  );
}

export function BudgetForm({ categories, today }: { categories: SelectOption[]; today: string }) {
  const t = useTranslations("finance");
  const [state, formAction, isPending] = useActionState(submitSetBudget, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("setBudget")}</h2>
      <p className={styles.hint}>{t("setBudgetHint")}</p>
      <form action={formAction} className={styles.form}>
        <SelectField label={t("budgetCategoryLabel")} name="category" options={categories} defaultValue="GROCERIES" />
        <TextField
          label={t("monthlyLimitLabel")}
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          hint={t("amountHint")}
        />
        <TextField label={t("startsOnLabel")} name="startsOn" type="date" required defaultValue={today} />
        <ErrorLine error={state.error} />
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("setBudget")}
        </Button>
      </form>
    </Card>
  );
}

export function OpenClaimForm({ claimable }: { claimable: { id: string; label: string }[] }) {
  const t = useTranslations("finance");
  const [state, formAction, isPending] = useActionState(submitCreateClaim, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("openClaim")}</h2>
      <form action={formAction} className={styles.form}>
        <TextField label={t("claimTitleLabel")} name="title" required autoComplete="off" />
        <TextField label={t("counterpartyLabel")} name="counterparty" autoComplete="off" />

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t("attachExpenses")}</legend>
          {claimable.length === 0 ? (
            <p className={styles.empty}>{t("nothingClaimable")}</p>
          ) : (
            claimable.map((expense) => (
              <label key={expense.id} className={styles.checkboxRow}>
                <input type="checkbox" name="expenseIds" value={expense.id} />
                <span>{expense.label}</span>
              </label>
            ))
          )}
        </fieldset>

        <ErrorLine error={state.error} />
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("openClaim")}
        </Button>
      </form>
    </Card>
  );
}

/**
 * One action on a claim.
 *
 * Which actions exist at all is decided by the caller from the claim's
 * status, which mirrors the state machine — an action the domain would
 * refuse is never offered. The domain still refuses it if posted anyway;
 * this is about not presenting dead ends.
 */
export function ClaimActionForm({
  claimId,
  version,
  currency,
  action,
  label,
  fields = [],
}: {
  claimId: string;
  version: number;
  currency: string;
  action: string;
  label: string;
  fields?: { name: string; label: string; type?: string; required?: boolean; hint?: string }[];
}) {
  const [state, formAction, isPending] = useActionState(submitClaimTransition, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.actionForm}>
      {/* The version travels with the action so a stale page is refused
          rather than silently overwriting someone else's change
          (CLAUDE.md §8). It is a hint, not a credential: the server
          re-reads and re-authorizes regardless. */}
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="action" value={action} />
      {fields.map((field) => (
        <TextField
          key={field.name}
          label={field.label}
          name={field.name}
          type={field.type}
          required={field.required}
          hint={field.hint}
          inputMode={field.name === "amount" ? "decimal" : undefined}
          autoComplete="off"
        />
      ))}
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant={action === "cancel" ? "secondary" : "primary"}>
        {label}
      </Button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  submitClaimTransition,
  submitCreateClaim,
  submitConfirmImport,
  submitPreviewImport,
  submitRecordExpense,
  submitSetBudget,
  type FinanceFormState,
  type ImportFormState,
} from "./actions";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { SelectField, type SelectOption } from "../../../components/ui/SelectField";
import { Money } from "../../../components/ui/Money";
import { TextField } from "../../../components/ui/TextField";
import { useHydrated } from "../../../components/ui/useHydrated";
import styles from "./finance.module.css";

const EMPTY: FinanceFormState = {};
const EMPTY_IMPORT: ImportFormState = {};

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

const IMPORT_ERROR_KEYS = {
  no_file: "errorNoFile",
  file_too_large: "errorFileTooLarge",
  not_authorized: "errorNotAuthorized",
  conflict: "errorConflict",
  invalid_input: "errorInvalidInput",
} as const;

const PLAN_ERROR_KEYS = {
  EMPTY_FILE: "importEmptyFile",
  NO_HEADER: "importNoHeader",
  TOO_MANY_ROWS: "importTooManyRows",
  MISSING_COLUMNS: "importMissingColumns",
} as const;

const ROW_PROBLEM_KEYS = {
  MISSING_DESCRIPTION: "problemMissingDescription",
  BAD_DATE: "problemBadDate",
  BAD_AMOUNT: "problemBadAmount",
  NON_POSITIVE_AMOUNT: "problemNonPositiveAmount",
  BAD_CURRENCY: "problemBadCurrency",
  UNKNOWN_CATEGORY: "problemUnknownCategory",
} as const;

/**
 * Import in two steps: read the file, show exactly what it would do, and
 * only write when the household says so.
 *
 * ADR-015 §2 commits to this specifically because the amount rule is
 * knowingly ambiguous for input like `1,234` and can be wrong by a factor
 * of a thousand. A preview is the only honest way to use a parser with
 * that property, and it is also what turns "12 rows were skipped" from a
 * silent loss into a visible decision.
 */
export function ImportExpensesForm({ month }: { month: string }) {
  const t = useTranslations("finance");
  const [previewState, previewAction, previewPending] = useActionState(submitPreviewImport, EMPTY_IMPORT);
  const [confirmState, confirmAction, confirmPending] = useActionState(submitConfirmImport, EMPTY_IMPORT);
  const hydrated = useHydrated();

  const state = confirmState.result || confirmState.error ? confirmState : previewState;
  const plan = previewState.preview?.plan;

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("importTitle")}</h2>
      <p className={styles.hint}>{t("importHint")}</p>

      <form action={previewAction} className={styles.form}>
        <label className={styles.fileLabel} htmlFor="import-file">
          {t("importFileLabel")}
        </label>
        <input
          id="import-file"
          className={styles.file}
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          aria-describedby="import-format"
        />
        <p id="import-format" className={styles.hint}>
          {t("importColumns")}
        </p>
        {state.error && (
          <p role="alert" className={styles.error}>
            {t(IMPORT_ERROR_KEYS[state.error as keyof typeof IMPORT_ERROR_KEYS] ?? "errorInvalidInput")}
          </p>
        )}
        <Button type="submit" disabled={previewPending || !hydrated}>
          {t("importPreview")}
        </Button>
      </form>

      {plan && !plan.ok && (
        <p role="alert" className={styles.error}>
          {plan.error === "MISSING_COLUMNS"
            ? t("importMissingColumns", { columns: (plan.missingColumns ?? []).join(", ") })
            : t(PLAN_ERROR_KEYS[plan.error])}
        </p>
      )}

      {plan?.ok && (
        <section aria-labelledby="import-preview-heading" className={styles.previewBlock}>
          <h3 id="import-preview-heading" className={styles.subtitle}>
            {t("importPreviewHeading")}
          </h3>
          <p className={styles.hint}>{t("importCounts", { importable: plan.importable, rejected: plan.rejected })}</p>

          {/*
            A region that scrolls must be reachable by keyboard, or a
            keyboard user can see a column they can never scroll to
            (axe: scrollable-region-focusable / WCAG 2.1.1). It therefore
            takes focus and an accessible name, which is the table's own
            caption — the heading above it is the section's, not the
            scroller's.
          */}
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="group"
            aria-label={t("importPreviewCaption")}
          >
            <table className={styles.table}>
              <caption className={styles.tableCaption}>{t("importPreviewCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("columnLine")}</th>
                  <th scope="col">{t("columnDate")}</th>
                  <th scope="col">{t("columnDescription")}</th>
                  <th scope="col" className={styles.numeric}>
                    {t("columnAmount")}
                  </th>
                  <th scope="col">{t("columnStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.line}>
                    <td>{row.line}</td>
                    <td>{row.incurredOn || "—"}</td>
                    <td>{row.description || "—"}</td>
                    <td className={styles.numeric}>
                      {/* The interpreted amount, which is the whole point
                          of showing this before writing anything. */}
                      {row.problems.some((p) => p.code === "BAD_AMOUNT") ? (
                        "—"
                      ) : (
                        <Money amountMinor={row.amountMinor} currency={row.currency} />
                      )}
                    </td>
                    <td>
                      {row.problems.length > 0 ? (
                        <span className={styles.rowSkipped}>
                          {row.problems.map((problem) => t(ROW_PROBLEM_KEYS[problem.code])).join("; ")}
                        </span>
                      ) : row.possibleDuplicate ? (
                        <span className={styles.rowDuplicate}>{t("rowDuplicate")}</span>
                      ) : (
                        <span className={styles.rowOk}>{t("rowWillImport")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {confirmState.result ? (
            <p role="status" className={styles.success}>
              {t("importDone", { imported: confirmState.result.imported, skipped: confirmState.result.skipped })}
            </p>
          ) : (
            <form action={confirmAction} className={styles.form}>
              {/* The reviewed text travels, not the reviewed rows: the
                  server re-plans it with the same pure function, so what
                  was shown and what is written cannot differ. */}
              <input type="hidden" name="csv" value={previewState.preview?.csv ?? ""} />
              <Button type="submit" disabled={confirmPending || !hydrated || plan.importable === 0}>
                {t("importConfirm", { count: plan.importable })}
              </Button>
            </form>
          )}
        </section>
      )}

      <p className={styles.exportLine}>
        <a href={`/api/finance/expenses?month=${month}`} download>
          {t("exportMonth", { month })}
        </a>
      </p>
    </Card>
  );
}

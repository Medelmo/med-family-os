"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitCreateCase, type CaseFormState } from "./actions";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { Card } from "../../../components/ui/Card";
import styles from "./cases.module.css";
import { useHydrated } from "../../../components/ui/useHydrated";

const EMPTY: CaseFormState = {};

const ERROR_KEYS = {
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
  illegal_transition: "errorIllegalTransition",
  follow_up_required: "errorFollowUpRequired",
  blocking_reason_required: "errorBlockingReasonRequired",
} as const;

export function useCaseErrorMessage() {
  const t = useTranslations("cases");
  return (error?: string) => (error ? t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput") : null);
}

export function OpenCaseForm() {
  const t = useTranslations("cases");
  const [state, formAction, isPending] = useActionState(submitCreateCase, EMPTY);
  const hydrated = useHydrated();
  const message = useCaseErrorMessage()(state.error);

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("openCase")}</h2>
      <form action={formAction} className={styles.form}>
        <TextField label={t("titleLabel")} name="title" required autoComplete="off" />
        <TextField label={t("nextActionLabel")} name="nextAction" autoComplete="off" />
        {message && (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        )}
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("openCase")}
        </Button>
      </form>
    </Card>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitSetup, type SetupFormState } from "./actions";
import { TextField } from "../../../components/ui/TextField";
import { Button } from "../../../components/ui/Button";
import styles from "../auth-panel.module.css";

const initialState: SetupFormState = {};

const ERROR_MESSAGE_KEYS = {
  already_set_up: "errorAlreadySetUp",
  invalid_input: "errorInvalidInput",
  unknown: "errorUnknown",
} as const;

export function SetupForm() {
  const t = useTranslations("setup");
  const [state, formAction, isPending] = useActionState(submitSetup, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <TextField label={t("householdNameLabel")} name="householdName" required autoComplete="off" />
      <TextField label={t("ownerNameLabel")} name="ownerName" required autoComplete="name" />
      <TextField label={t("emailLabel")} name="ownerEmail" type="email" required autoComplete="email" />
      <TextField
        label={t("passwordLabel")}
        name="ownerPassword"
        type="password"
        required
        minLength={12}
        hint={t("passwordHint")}
        autoComplete="new-password"
      />
      {state.error && (
        <p role="alert" className={styles.error}>
          {t(ERROR_MESSAGE_KEYS[state.error as keyof typeof ERROR_MESSAGE_KEYS] ?? "errorUnknown")}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {t("submit")}
      </Button>
    </form>
  );
}

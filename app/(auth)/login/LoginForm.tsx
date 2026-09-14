"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitLogin, type LoginFormState } from "./actions";
import { TextField } from "../../../components/ui/TextField";
import { Button } from "../../../components/ui/Button";
import styles from "../auth-panel.module.css";

const initialState: LoginFormState = {};

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, isPending] = useActionState(submitLogin, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <TextField label={t("emailLabel")} name="email" type="email" required autoComplete="email" />
      <TextField label={t("passwordLabel")} name="password" type="password" required autoComplete="current-password" />
      {state.error && (
        <p role="alert" className={styles.error}>
          {t("error")}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {t("submit")}
      </Button>
    </form>
  );
}

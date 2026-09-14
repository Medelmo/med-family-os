"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitAddMember, type AddMemberFormState } from "./actions";
import { TextField } from "../../../components/ui/TextField";
import { Button } from "../../../components/ui/Button";
import styles from "./family.module.css";
import { useHydrated } from "../../../components/ui/useHydrated";

const initialState: AddMemberFormState = {};

export function AddMemberForm() {
  const t = useTranslations("family");
  const [state, formAction, isPending] = useActionState(submitAddMember, initialState);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.addForm}>
      <TextField label={t("displayNameLabel")} name="displayName" required autoComplete="off" />
      <label className={styles.selectLabel}>
        {t("roleLabel")}
        <select name="role" className={styles.select} defaultValue="ADULT" required>
          <option value="ADMIN">ADMIN</option>
          <option value="ADULT">ADULT</option>
          <option value="CHILD">CHILD</option>
          <option value="VIEWER">VIEWER</option>
        </select>
      </label>
      <TextField label={t("emailLabel")} name="email" type="email" autoComplete="off" />
      <TextField
        label={t("temporaryPasswordLabel")}
        name="temporaryPassword"
        type="password"
        minLength={12}
        autoComplete="new-password"
      />
      {state.error && (
        <p role="alert" className={styles.error}>
          {t(state.error === "not_authorized" ? "errorNotAuthorized" : "errorInvalidInput")}
        </p>
      )}
      <Button type="submit" disabled={isPending || !hydrated}>
        {t("addMember")}
      </Button>
    </form>
  );
}

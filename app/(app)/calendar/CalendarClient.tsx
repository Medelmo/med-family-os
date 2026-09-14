"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitCreateEvent, type CalendarFormState } from "./actions";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { Card } from "../../../components/ui/Card";
import styles from "./calendar.module.css";
import { useHydrated } from "../../../components/ui/useHydrated";

const EMPTY: CalendarFormState = {};

export function AddEventForm() {
  const t = useTranslations("calendar");
  const [state, formAction, isPending] = useActionState(submitCreateEvent, EMPTY);
  const hydrated = useHydrated();

  return (
    <Card>
      <h2 className={styles.subtitle}>{t("addEvent")}</h2>
      <form action={formAction} className={styles.form}>
        <TextField label={t("titleLabel")} name="title" required autoComplete="off" />
        <TextField label={t("dateLabel")} name="date" type="date" required />
        <TextField label={t("timeLabel")} name="time" type="time" defaultValue="09:00" />
        <TextField label={t("locationLabel")} name="location" autoComplete="off" />
        <label className={styles.selectLabel}>
          {t("repeatLabel")}
          <select name="frequency" className={styles.select} defaultValue="NONE">
            <option value="NONE">{t("repeat.NONE")}</option>
            <option value="DAILY">{t("repeat.DAILY")}</option>
            <option value="WEEKLY">{t("repeat.WEEKLY")}</option>
            <option value="MONTHLY">{t("repeat.MONTHLY")}</option>
            <option value="YEARLY">{t("repeat.YEARLY")}</option>
          </select>
        </label>
        {state.error && (
          <p role="alert" className={styles.error}>
            {t(state.error === "not_authorized" ? "errorNotAuthorized" : "errorInvalidInput")}
          </p>
        )}
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("addEvent")}
        </Button>
      </form>
    </Card>
  );
}

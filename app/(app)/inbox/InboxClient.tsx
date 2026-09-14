"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { submitCapture, submitDiscard, submitTriageToTask, type InboxFormState } from "./actions";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { Card } from "../../../components/ui/Card";
import styles from "./inbox.module.css";
import { useHydrated } from "../../../components/ui/useHydrated";

const EMPTY: InboxFormState = {};

const ERROR_KEYS = {
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
} as const;

function useErrorMessage() {
  const t = useTranslations("inbox");
  return (error?: string) => (error ? t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput") : null);
}

export function CaptureBox() {
  const t = useTranslations("inbox");
  const [state, formAction, isPending] = useActionState(submitCapture, EMPTY);
  const hydrated = useHydrated();
  const message = useErrorMessage()(state.error);

  return (
    <Card>
      <form action={formAction} className={styles.captureForm}>
        <TextField label={t("captureLabel")} name="capturedText" required autoComplete="off" />
        {message && (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        )}
        <Button type="submit" disabled={isPending || !hydrated}>
          {t("captureButton")}
        </Button>
      </form>
    </Card>
  );
}

export interface InboxItemView {
  id: string;
  capturedText: string;
  version: number;
}

export function InboxItemRow({ item }: { item: InboxItemView }) {
  const t = useTranslations("inbox");
  const [expanded, setExpanded] = useState(false);
  const [triageState, triageAction, triagePending] = useActionState(submitTriageToTask, EMPTY);
  const hydrated = useHydrated();
  const [discardState, discardAction, discardPending] = useActionState(submitDiscard, EMPTY);
  const toMessage = useErrorMessage();
  const message = toMessage(triageState.error) ?? toMessage(discardState.error);

  return (
    <Card className={styles.item}>
      <p className={styles.capturedText}>{item.capturedText}</p>

      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}

      <div className={styles.itemActions}>
        <Button type="button" variant="secondary" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
          {t("makeTask")}
        </Button>
        <form action={discardAction}>
          <input type="hidden" name="inboxItemId" value={item.id} />
          <input type="hidden" name="expectedVersion" value={item.version} />
          <Button type="submit" variant="secondary" disabled={discardPending || !hydrated}>
            {t("discard")}
          </Button>
        </form>
      </div>

      {expanded && (
        <form action={triageAction} className={styles.triageForm}>
          <input type="hidden" name="inboxItemId" value={item.id} />
          <input type="hidden" name="expectedVersion" value={item.version} />
          <TextField label={t("taskTitleLabel")} name="title" defaultValue={item.capturedText} required />
          <TextField label={t("nextActionLabel")} name="nextAction" />
          <TextField label={t("dueOnLabel")} name="dueOn" type="date" />
          <Button type="submit" disabled={triagePending || !hydrated}>
            {t("createTask")}
          </Button>
        </form>
      )}
    </Card>
  );
}

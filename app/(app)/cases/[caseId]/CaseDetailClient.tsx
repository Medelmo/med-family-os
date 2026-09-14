"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  submitCaseNextAction,
  submitCaseNote,
  submitCaseTransition,
  type CaseFormState,
} from "../actions";
import { useCaseErrorMessage } from "../CasesClient";
import { Button } from "../../../../components/ui/Button";
import { TextField } from "../../../../components/ui/TextField";
import { Card } from "../../../../components/ui/Card";
import styles from "./caseDetail.module.css";
import { useHydrated } from "../../../../components/ui/useHydrated";

const EMPTY: CaseFormState = {};

export type CaseStatusName = "DRAFT" | "ACTIVE" | "WAITING" | "BLOCKED" | "COMPLETED" | "CANCELLED" | "ARCHIVED";

/** Mirrors the transitions domain/cases/case.ts permits from each status. */
const ACTIONS_BY_STATUS: Record<CaseStatusName, { action: string; labelKey: string; needsForm?: "wait" | "block" }[]> = {
  DRAFT: [
    { action: "activate", labelKey: "activate" },
    { action: "cancel", labelKey: "cancel" },
  ],
  ACTIVE: [
    { action: "wait", labelKey: "wait", needsForm: "wait" },
    { action: "block", labelKey: "block", needsForm: "block" },
    { action: "complete", labelKey: "complete" },
    { action: "cancel", labelKey: "cancel" },
  ],
  WAITING: [
    { action: "resume", labelKey: "resume" },
    { action: "cancel", labelKey: "cancel" },
  ],
  BLOCKED: [
    { action: "resume", labelKey: "resume" },
    { action: "cancel", labelKey: "cancel" },
  ],
  COMPLETED: [{ action: "archive", labelKey: "archive" }],
  CANCELLED: [],
  ARCHIVED: [],
};

export function CaseActions({ caseId, status, version }: { caseId: string; status: CaseStatusName; version: number }) {
  const t = useTranslations("cases");
  const [state, formAction, isPending] = useActionState(submitCaseTransition, EMPTY);
  const hydrated = useHydrated();
  const [openForm, setOpenForm] = useState<"wait" | "block" | null>(null);
  const message = useCaseErrorMessage()(state.error);

  const actions = ACTIONS_BY_STATUS[status];
  // A successful transition re-renders this component with a new status,
  // but `openForm` is client state and survives it — so an expanded
  // "waiting" form stayed on screen after the case had already moved to
  // WAITING, offering an action the state machine would now reject.
  // Deriving visibility from the current status as well as the toggle
  // keeps the two from disagreeing.
  const visibleForm = actions.some((a) => a.needsForm === openForm) ? openForm : null;

  return (
    <Card className={styles.actionsCard}>
      <h2 className={styles.sectionTitle}>{t("actionsTitle")}</h2>

      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}

      {actions.length === 0 ? (
        <p className={styles.meta}>{t("noActions")}</p>
      ) : (
        <div className={styles.actions}>
          {actions.map(({ action, labelKey, needsForm }) =>
            needsForm ? (
              <Button
                key={action}
                type="button"
                variant="secondary"
                aria-expanded={visibleForm === needsForm}
                onClick={() => setOpenForm((open) => (open === needsForm ? null : needsForm))}
              >
                {t(`actions.${labelKey}`)}
              </Button>
            ) : (
              <form action={formAction} key={action}>
                <input type="hidden" name="caseId" value={caseId} />
                <input type="hidden" name="expectedVersion" value={version} />
                <input type="hidden" name="action" value={action} />
                <Button type="submit" variant={action === "cancel" ? "secondary" : "primary"} disabled={isPending || !hydrated}>
                  {t(`actions.${labelKey}`)}
                </Button>
              </form>
            )
          )}
        </div>
      )}

      {visibleForm === "wait" && (
        <form action={formAction} className={styles.inlineForm}>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input type="hidden" name="action" value="wait" />
          <TextField label={t("waitingForLabel")} name="waitingFor" required />
          <TextField label={t("followUpLabel")} name="followUpAt" type="date" />
          {/* The domain requires a date *or* a stated reason — never
              silently neither (domain/cases/case.ts). */}
          <TextField label={t("noFollowUpReasonLabel")} name="noFollowUpReason" />
          <TextField label={t("externalReferenceLabel")} name="externalReference" />
          <Button type="submit" disabled={isPending || !hydrated}>
            {t("actions.wait")}
          </Button>
        </form>
      )}

      {visibleForm === "block" && (
        <form action={formAction} className={styles.inlineForm}>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input type="hidden" name="action" value="block" />
          <TextField label={t("blockedReasonLabel")} name="blockedReason" required />
          <Button type="submit" disabled={isPending || !hydrated}>
            {t("actions.block")}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function NextActionForm({
  caseId,
  version,
  nextAction,
}: {
  caseId: string;
  version: number;
  nextAction: string | null;
}) {
  const t = useTranslations("cases");
  const [state, formAction, isPending] = useActionState(submitCaseNextAction, EMPTY);
  const hydrated = useHydrated();
  const message = useCaseErrorMessage()(state.error);

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <TextField label={t("nextActionLabel")} name="nextAction" defaultValue={nextAction ?? ""} />
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={isPending || !hydrated}>
        {t("saveNextAction")}
      </Button>
    </form>
  );
}

export function AddNoteForm({ caseId }: { caseId: string }) {
  const t = useTranslations("cases");
  const [state, formAction, isPending] = useActionState(submitCaseNote, EMPTY);
  const hydrated = useHydrated();
  const message = useCaseErrorMessage()(state.error);

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="caseId" value={caseId} />
      <TextField label={t("noteLabel")} name="body" required autoComplete="off" />
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={isPending || !hydrated}>
        {t("addNote")}
      </Button>
    </form>
  );
}

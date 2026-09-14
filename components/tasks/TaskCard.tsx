"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitTaskTransition, type TaskActionState } from "../../app/(app)/tasks/actions";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import styles from "./TaskCard.module.css";
import { useHydrated } from "../ui/useHydrated";

const EMPTY: TaskActionState = {};

const ERROR_KEYS = {
  illegal_transition: "errorIllegalTransition",
  owner_required: "errorOwnerRequired",
  follow_up_required: "errorFollowUpRequired",
  conflict: "errorConflict",
  not_authorized: "errorNotAuthorized",
} as const;

export type TaskStatusName = "INBOX" | "PLANNED" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "CANCELLED";

export interface TaskCardData {
  id: string;
  title: string;
  status: TaskStatusName;
  dueOn: string | null;
  nextAction: string | null;
  waitingFor: string | null;
  ownerName: string | null;
  version: number;
}

/** Mirrors the transitions domain/tasks/task.ts permits from each status. */
const ACTIONS_BY_STATUS: Record<TaskStatusName, { action: string; labelKey: string; variant?: "secondary" }[]> = {
  INBOX: [
    { action: "plan", labelKey: "start" },
    { action: "cancel", labelKey: "cancel", variant: "secondary" },
  ],
  PLANNED: [
    { action: "start", labelKey: "start" },
    { action: "cancel", labelKey: "cancel", variant: "secondary" },
  ],
  IN_PROGRESS: [
    { action: "complete", labelKey: "complete" },
    { action: "cancel", labelKey: "cancel", variant: "secondary" },
  ],
  WAITING: [{ action: "resume", labelKey: "resume" }],
  COMPLETED: [{ action: "reopen", labelKey: "reopen", variant: "secondary" }],
  CANCELLED: [],
};

export function TaskCard({ task }: { task: TaskCardData }) {
  const t = useTranslations("tasks");
  const [state, formAction, isPending] = useActionState(submitTaskTransition, EMPTY);
  const hydrated = useHydrated();
  const errorKey = state.error ? (ERROR_KEYS[state.error as keyof typeof ERROR_KEYS] ?? "errorIllegalTransition") : null;

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>{task.title}</h3>
        {/* Status is a word, not only a colour — CLAUDE.md §13 forbids
            communicating state by colour alone. */}
        <span className={styles.status} data-status={task.status}>
          {t(`status.${task.status}`)}
        </span>
      </div>

      <dl className={styles.meta}>
        {task.dueOn && (
          <div className={styles.metaRow}>
            <dt>{t("dueLabel")}</dt>
            <dd>{task.dueOn}</dd>
          </div>
        )}
        <div className={styles.metaRow}>
          <dt>{t("nextActionLabel")}</dt>
          <dd className={task.nextAction ? undefined : styles.missing}>{task.nextAction ?? t("noNextAction")}</dd>
        </div>
        {task.waitingFor && (
          <div className={styles.metaRow}>
            <dt>{t("waitingForLabel")}</dt>
            <dd>{task.waitingFor}</dd>
          </div>
        )}
        <div className={styles.metaRow}>
          <dt>{t("ownerLabel")}</dt>
          <dd>{task.ownerName ?? t("noOwner")}</dd>
        </div>
      </dl>

      {errorKey && (
        <p role="alert" className={styles.error}>
          {t(errorKey)}
        </p>
      )}

      <div className={styles.actions}>
        {ACTIONS_BY_STATUS[task.status].map(({ action, labelKey, variant }) => (
          <form action={formAction} key={action}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="expectedVersion" value={task.version} />
            <input type="hidden" name="action" value={action} />
            <Button type="submit" variant={variant} disabled={isPending || !hydrated}>
              {t(`actions.${labelKey}`)}
            </Button>
          </form>
        ))}
      </div>
    </Card>
  );
}

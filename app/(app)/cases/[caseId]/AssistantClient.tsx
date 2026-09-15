"use client";

import { useActionState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  submitAcceptSuggestion,
  submitAskAssistant,
  submitRejectSuggestion,
  type AssistantFormState,
} from "./assistantActions";
import { Button } from "../../../../components/ui/Button";
import { useHydrated } from "../../../../components/ui/useHydrated";
import styles from "./assistant.module.css";

const EMPTY: AssistantFormState = {};

const ERROR_KEYS: Record<string, string> = {
  not_configured: "errorNotConfigured",
  unreachable: "errorUnreachable",
  timeout: "errorTimeout",
  refused: "errorRefused",
  malformed: "errorMalformed",
  unusable: "errorUnusable",
  not_authorized: "errorNotAuthorized",
  conflict: "errorConflict",
  not_found: "errorNotFound",
};

function Problem({ error }: { error?: string }) {
  const t = useTranslations("assistant");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(ERROR_KEYS[error] ?? "errorUnreachable")}
    </p>
  );
}

export function AskAssistantForm({ caseId }: { caseId: string }) {
  const t = useTranslations("assistant");
  const [state, formAction, isPending] = useActionState(submitAskAssistant, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.ask}>
      <input type="hidden" name="caseId" value={caseId} />
      <Button type="submit" variant="secondary" disabled={isPending || !hydrated}>
        {isPending ? t("asking") : t("ask")}
      </Button>
      <Problem error={state.error} />
      {state.empty && (
        <p role="status" className={styles.note}>
          {t("nothingToSuggest")}
        </p>
      )}
    </form>
  );
}

export interface SuggestionView {
  id: string;
  nextAction: string;
  model: string;
  locality: "LOCAL" | "REMOTE";
  promptVersion: string;
  generatedAt: string;
  withheld: { sensitivity: string; count: number }[];
  redacted: string[];
}

/**
 * One suggestion, with its provenance on the face of it (ADR-027).
 *
 * CLAUDE.md §11 asks for "visible provenance", and the operative word is
 * visible: not a tooltip, not a details pane, not an icon somebody learns
 * to ignore. Which model, where it ran, and what it was not shown all sit
 * next to the sentence they produced — because the reader is about to
 * decide whether to act on it, and those facts are what the decision is
 * made of.
 */
export function SuggestionCard({ caseId, suggestion }: { caseId: string; suggestion: SuggestionView }) {
  const t = useTranslations("assistant");
  const format = useFormatter();
  const hydrated = useHydrated();

  const [acceptState, acceptAction, accepting] = useActionState(submitAcceptSuggestion, EMPTY);
  const [rejectState, rejectAction, rejecting] = useActionState(submitRejectSuggestion, EMPTY);
  const busy = accepting || rejecting;

  return (
    <article className={styles.card}>
      {/* Said in words, not only by the panel's styling: somebody arriving
          at this page mid-scroll must not mistake a proposal for a fact
          the household recorded (WCAG 1.4.1, and plain honesty). */}
      <p className={styles.badge}>{t("proposed")}</p>

      <p className={styles.suggestion}>{suggestion.nextAction}</p>

      <dl className={styles.provenance}>
        <div>
          <dt>{t("model")}</dt>
          <dd>
            <code>{suggestion.model}</code>{" "}
            <span className={styles.locality} data-locality={suggestion.locality}>
              {suggestion.locality === "LOCAL" ? t("localityLocal") : t("localityRemote")}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t("generated")}</dt>
          <dd>{format.dateTime(new Date(suggestion.generatedAt), { dateStyle: "medium", timeStyle: "short" })}</dd>
        </div>
        <div>
          <dt>{t("prompt")}</dt>
          <dd>
            <code>{suggestion.promptVersion}</code>
          </dd>
        </div>
      </dl>

      {/* A suggestion built from part of a case is incomplete rather than
          wrong, and that difference decides whether to act on it. */}
      {suggestion.withheld.length > 0 && (
        <p className={styles.note}>
          {t("withheld", { count: suggestion.withheld.reduce((sum, w) => sum + w.count, 0) })}
        </p>
      )}
      {suggestion.redacted.length > 0 && <p className={styles.note}>{t("redacted")}</p>}

      <div className={styles.decide}>
        <form action={acceptAction}>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="suggestionId" value={suggestion.id} />
          <Button type="submit" disabled={busy || !hydrated}>
            {t("accept")}
          </Button>
        </form>

        <form action={rejectAction}>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="suggestionId" value={suggestion.id} />
          <Button type="submit" variant="secondary" disabled={busy || !hydrated}>
            {t("reject")}
          </Button>
        </form>
      </div>

      <Problem error={acceptState.error ?? rejectState.error} />
    </article>
  );
}

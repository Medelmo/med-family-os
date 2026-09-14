"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitLinkRecord, submitUnlinkRecord, type LinkFormState } from "./linkActions";
import { Button } from "../../../../components/ui/Button";
import { SelectField, type SelectOption } from "../../../../components/ui/SelectField";
import { TextField } from "../../../../components/ui/TextField";
import { useHydrated } from "../../../../components/ui/useHydrated";
import styles from "./caseDetail.module.css";

const EMPTY: LinkFormState = {};

const ERROR_KEYS = {
  self_link: "errorSelfLink",
  not_found: "errorNotFound",
  not_authorized: "errorNotAuthorized",
  invalid_input: "errorInvalidInput",
} as const;

function ErrorLine({ error }: { error?: string }) {
  const t = useTranslations("links");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(ERROR_KEYS[error as keyof typeof ERROR_KEYS] ?? "errorInvalidInput")}
    </p>
  );
}

/**
 * Links this case to something else.
 *
 * The choices come from the server already filtered to what this reader
 * may see, so the list cannot become a way to discover records. The
 * command checks again regardless — a select is presentation, and a form
 * can be posted with anything.
 */
export function LinkRecordForm({ caseId, options }: { caseId: string; options: SelectOption[] }) {
  const t = useTranslations("links");
  const [state, formAction, isPending] = useActionState(submitLinkRecord, EMPTY);
  const hydrated = useHydrated();

  if (options.length === 0) {
    return <p className={styles.meta}>{t("nothingToLink")}</p>;
  }

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="caseId" value={caseId} />
      <SelectField label={t("linkLabel")} name="target" options={options} />
      <TextField label={t("noteLabel")} name="note" autoComplete="off" hint={t("noteHint")} />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={isPending || !hydrated} variant="secondary">
        {t("link")}
      </Button>
    </form>
  );
}

export function UnlinkForm({ caseId, linkId, label }: { caseId: string; linkId: string; label: string }) {
  const t = useTranslations("links");
  const [state, formAction, isPending] = useActionState(submitUnlinkRecord, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="linkId" value={linkId} />
      <ErrorLine error={state.error} />
      {/* Short visible text, full name in the accessible name.
       *
       * The first version put the whole record name in the button, so a
       * screen reader would hear which of several it unlinks rather than
       * five identical "Unlink" buttons. It also made the button 395px
       * wide on a 412px phone and pushed the page sideways — caught by
       * this page's own overflow guard.
       *
       * The accessible name still begins with the visible word, so
       * WCAG 2.2 SC 2.5.3 (Label in Name) holds and voice control still
       * works by saying "Unlink". */}
      <Button
        type="submit"
        disabled={isPending || !hydrated}
        variant="secondary"
        aria-label={t("unlinkNamed", { label })}
      >
        {t("unlink")}
      </Button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { submitLanguage, type LanguageFormState } from "./actions";
import { Button } from "../../../../components/ui/Button";
import { SelectField } from "../../../../components/ui/SelectField";
import { useHydrated } from "../../../../components/ui/useHydrated";

const EMPTY: LanguageFormState = {};

export function LanguageForm({ current }: { current: string }) {
  const t = useTranslations("settings");
  const [state, formAction, isPending] = useActionState(submitLanguage, EMPTY);
  const hydrated = useHydrated();

  return (
    <form action={formAction}>
      <SelectField
        label={t("languageLabel")}
        name="locale"
        defaultValue={current}
        options={[
          // Each language is named in itself, never translated. Somebody
          // looking for German is looking for the word "Deutsch".
          { value: "en", label: t("languageEn") },
          { value: "de", label: t("languageDe") },
        ]}
        hint={t("languageHint")}
      />

      <Button type="submit" variant="secondary" disabled={isPending || !hydrated}>
        {t("languageSave")}
      </Button>

      {state.saved && (
        <p role="status" style={{ marginTop: "var(--space-3)", color: "var(--color-success)" }}>
          {t("languageSaved")}
        </p>
      )}
    </form>
  );
}

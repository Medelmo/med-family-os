"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { submitDesign, type AppearanceFormState } from "./actions";
import { Button } from "../../../../components/ui/Button";
import { useHydrated } from "../../../../components/ui/useHydrated";
import { DESIGN_WORLDS, type DesignId } from "../../../design-worlds";
import styles from "./appearance.module.css";

const EMPTY: AppearanceFormState = {};

/**
 * Choosing a world previews instantly and saves explicitly (ADR-029).
 *
 * The preview (`data-design` set on `<html>` the moment a radio is
 * picked) is what makes the choice feel "applied directly" — every panel
 * on the page reskins on the next paint, with no round trip. Saving is
 * still a separate, explicit step, for the same reason `LanguageForm`
 * keeps one: a radio group fires a change event for *every* option a
 * keyboard user arrows past, and turning each of those into a save would
 * write the cookie several times before anyone has actually decided.
 * Leaving without saving reverts to the last saved world on the next full
 * reload — signalled by the unsaved state below, never silent.
 */
export function AppearanceForm({ current }: { current: DesignId }) {
  const t = useTranslations("settings");
  const [state, formAction, isPending] = useActionState(submitDesign, EMPTY);
  const hydrated = useHydrated();
  const [previewId, setPreviewId] = useState<DesignId>(current);

  // The mutation itself lives in an effect, not the change handler: it
  // touches `document`, which is outside this component, and an effect is
  // where synchronising with something outside React belongs.
  useEffect(() => {
    try {
      document.documentElement.dataset.design = previewId;
    } catch {
      // Storage/DOM access can throw in locked-down environments; the
      // form still submits and the server-rendered attribute still wins
      // on the next load.
    }
  }, [previewId]);

  return (
    <form action={formAction}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t("appearanceLabel")}</legend>
        <div className={styles.grid}>
          {DESIGN_WORLDS.map((world) => (
            <label key={world.id} className={styles.option}>
              <input
                type="radio"
                name="design"
                value={world.id}
                defaultChecked={world.id === current}
                onChange={() => setPreviewId(world.id)}
                className={styles.input}
              />
              <span className={styles.card}>
                <span className={styles.swatches} aria-hidden="true">
                  {world.swatches.map((hex, i) => (
                    <span key={i} className={styles.swatch} style={{ background: hex }} />
                  ))}
                </span>
                <span className={styles.name}>{t(world.nameKey)}</span>
                <span className={styles.hint}>{t(world.descriptionKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" variant="secondary" disabled={isPending || !hydrated}>
        {t("appearanceSave")}
      </Button>

      {state.saved && (
        <p role="status" style={{ marginTop: "var(--space-3)", color: "var(--color-success)" }}>
          {t("appearanceSaved")}
        </p>
      )}
      {state.error && (
        <p role="alert" style={{ marginTop: "var(--space-3)", color: "var(--color-critical)" }}>
          {t("appearanceError")}
        </p>
      )}
    </form>
  );
}

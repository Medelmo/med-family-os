import { getLocale, getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { Card } from "../../../../components/ui/Card";
import { LanguageForm } from "./LanguageForm";
import styles from "../settings.module.css";

/**
 * Language (ADR-008's missing half, finally built).
 *
 * ADR-008 chose a per-user locale held in a cookie and noted that "Phase 1
 * has no Settings UI yet to write it" — which meant the German half of a
 * bilingual application was unreachable from inside it. This is that page.
 *
 * Open to everybody, not just an owner: what language you read the
 * interface in is not an administrative decision about the household, and
 * a child who reads German should not have to ask an adult to change it.
 */
export default async function LanguagePage() {
  await requireActor();
  const t = await getTranslations("settings");
  const locale = await getLocale();

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("language")}</h1>
        <p className={styles.description}>{t("languageHint")}</p>
      </header>

      <Card>
        <LanguageForm current={locale} />
      </Card>
    </div>
  );
}

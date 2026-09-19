import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { Card } from "../../../../components/ui/Card";
import { DEFAULT_DESIGN, DESIGN_COOKIE, isSupportedDesign } from "../../../design-worlds";
import { AppearanceForm } from "./AppearanceForm";
import styles from "../settings.module.css";

/**
 * Appearance — the design-world picker (ADR-029).
 *
 * Open to everybody, like `/settings/language`: which visual world you
 * read the household's attention list in is not an administrative
 * decision, and a child should not have to ask an adult to switch away
 * from a screen they find hard to read.
 */
export default async function AppearancePage() {
  await requireActor();
  const t = await getTranslations("settings");
  const store = await cookies();
  const cookieValue = store.get(DESIGN_COOKIE)?.value;
  const current = isSupportedDesign(cookieValue) ? cookieValue : DEFAULT_DESIGN;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("appearance")}</h1>
        <p className={styles.description}>{t("appearanceHint")}</p>
      </header>

      <Card>
        <AppearanceForm current={current} />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { authorizeIntegrationAccess } from "../../../application/policies/integrations";
import { Card } from "../../../components/ui/Card";
import styles from "./settings.module.css";

/**
 * The settings index.
 *
 * It exists so the navigation has one destination rather than one per
 * setting, and so a household member who is not an owner sees a page that
 * makes sense to them instead of a nav entry that leads somewhere they are
 * refused.
 *
 * Which links appear is decided on the server from the same policies the
 * pages enforce. Hiding a link is presentation, not authorization — the
 * page itself refuses regardless — but offering somebody a door they
 * cannot open is its own kind of broken.
 */
export default async function SettingsPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("settings");

  const canManageIntegrations = authorizeIntegrationAccess(actor, householdId);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      <Card>
        <ul className={styles.list}>
          {canManageIntegrations ? (
            <li className={styles.row}>
              <Link href="/settings/integrations" className={styles.link}>
                {t("integrations")}
              </Link>
              <span className={styles.meta}>{t("integrationsHint")}</span>
            </li>
          ) : (
            <li className={styles.row}>
              <span className={styles.meta}>{t("nothingForYou")}</span>
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}

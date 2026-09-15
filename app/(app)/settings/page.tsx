import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { authorizeIntegrationAccess } from "../../../application/policies/integrations";
import { authorizeHouseholdSettingsAccess } from "../../../application/policies/household";
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
  const canSeeBackup = authorizeHouseholdSettingsAccess(actor, "read", householdId);

  const entries = [
    canManageIntegrations && { href: "/settings/integrations", label: "integrations", hint: "integrationsHint" },
    // Open to everybody: what language you read in is not an
    // administrative decision about the household.
    { href: "/settings/language", label: "language", hint: "languageHint" },
    // Offered to everybody, deliberately. An export is the one thing on
    // this page that is not administration: it is a person taking their
    // own data, and it gives each of them exactly what they can see.
    { href: "/settings/export", label: "export", hint: "exportHint" },
    canSeeBackup && { href: "/settings/backup", label: "backup", hint: "backupHint" },
  ].filter(Boolean) as { href: string; label: string; hint: string }[];

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      <Card>
        <ul className={styles.list}>
          {entries.length === 0 ? (
            <li className={styles.row}>
              <span className={styles.meta}>{t("nothingForYou")}</span>
            </li>
          ) : (
            entries.map((entry) => (
              <li className={styles.row} key={entry.href}>
                <Link href={entry.href} className={styles.link}>
                  {t(entry.label)}
                </Link>
                <span className={styles.meta}>{t(entry.hint)}</span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}

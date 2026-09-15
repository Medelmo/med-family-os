import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { getBackupStatus } from "../../../../application/queries/backup/getBackupStatus";
import { authorizeHouseholdSettingsAccess } from "../../../../application/policies/household";
import { Card } from "../../../../components/ui/Card";
import styles from "../settings.module.css";
import backupStyles from "./backup.module.css";

/**
 * Backup and restore status (screen 49).
 *
 * **This application does not take the backups.** They live in the
 * household's homelab, where `docs/backup/backup-restore.md` puts them,
 * and CLAUDE.md §0 is explicit that this app does not replace
 * infrastructure it does not own. So there is no green tick here. A
 * "Backups: healthy" badge for a job this process cannot see would be the
 * most dangerous thing on the page — a reassurance with nothing behind
 * it, believed exactly until the day it mattered.
 *
 * What the page does instead is give the restore drill the numbers it
 * asks for. Steps 5 and 6 are "run integrity checks" and "verify
 * representative records", which are unanswerable without something to
 * compare against. Printed or noted before a restore, these counts turn
 * "it seems to have worked" into a check.
 */
export default async function BackupPage() {
  const { actor, householdId } = await requireActor();
  const [t, format] = await Promise.all([getTranslations("backup"), getFormatter()]);

  if (!authorizeHouseholdSettingsAccess(actor, "update", householdId)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t("title")}</h1>
        <Card>
          <p className={styles.meta}>{t("ownersOnly")}</p>
        </Card>
      </div>
    );
  }

  const status = await getBackupStatus(actor, householdId);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {/* First, and before any numbers: what this page is not. */}
      <Card>
        <h2 className={backupStyles.subtitle}>{t("notOursTitle")}</h2>
        <p className={styles.meta}>{t("notOurs")}</p>
      </Card>

      <Card>
        <h2 className={backupStyles.subtitle}>{t("yoursTitle")}</h2>
        <ul className={backupStyles.bullets}>
          <li>{t("layerDatabase")}</li>
          <li>{t("layerVolume")}</li>
          <li>{t("layerConfig")}</li>
          <li>{t("layerExport")}</li>
        </ul>

        {/* The one mistake that looks completely correct until the day the
            dump is stolen, so it gets its own emphasis rather than a
            bullet among four (ADR-019). */}
        <p className={backupStyles.warning} role="note">
          {t("keysWarning")}
        </p>
        <p className={styles.meta}>
          {status.keyringConfigured ? t("keyringConfigured") : t("keyringMissing")}
        </p>
      </Card>

      <Card>
        <h2 className={backupStyles.subtitle}>{t("verifyTitle")}</h2>
        <p className={styles.meta}>{t("verifyIntro")}</p>

        <dl className={backupStyles.facts}>
          <div className={backupStyles.fact}>
            <dt>{t("schemaVersion")}</dt>
            <dd>{status.schemaVersion ?? t("unknown")}</dd>
          </div>
          <div className={backupStyles.fact}>
            <dt>{t("databaseSize")}</dt>
            <dd>
              {status.databaseBytes === null
                ? t("unknown")
                : t("megabytes", { mb: Math.round((status.databaseBytes / 1_048_576) * 10) / 10 })}
            </dd>
          </div>
          <div className={backupStyles.fact}>
            <dt>{t("totalRows")}</dt>
            <dd>{format.number(status.totalRows)}</dd>
          </div>
          <div className={backupStyles.fact}>
            <dt>{t("lastExport")}</dt>
            <dd>
              {status.lastExport
                ? format.dateTime(status.lastExport.at, { dateStyle: "medium", timeStyle: "short" })
                : t("neverExported")}
            </dd>
          </div>
        </dl>

        {/* Keyboard-reachable for the same reason as the finance import
            preview: a scrollable region nobody can focus is a column
            nobody can reach (WCAG 2.1.1). */}
        <div
          className={backupStyles.tableWrap}
          tabIndex={0}
          role="group"
          aria-label={t("countsCaption", {
            at: format.dateTime(status.takenAt, { dateStyle: "medium", timeStyle: "short" }),
          })}
        >
          <table className={backupStyles.table}>
            <caption className={backupStyles.caption}>
              {t("countsCaption", {
                at: format.dateTime(status.takenAt, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("columnTable")}</th>
                <th scope="col" className={backupStyles.numeric}>
                  {t("columnRows")}
                </th>
                <th scope="col">{t("columnNewest")}</th>
              </tr>
            </thead>
            <tbody>
              {status.tables.map((row) => (
                <tr key={row.table}>
                  {/* The database's own table name, not a friendly one:
                      this is for comparing against a restored database,
                      where the table name is what you will be looking at. */}
                  <th scope="row">
                    <code>{row.table}</code>
                  </th>
                  {/* "could not count" is not "none" — see getBackupStatus. */}
                  <td className={backupStyles.numeric}>
                    {row.rows === null ? t("unknown") : format.number(row.rows)}
                  </td>
                  <td>
                    {row.newest ? format.dateTime(row.newest, { dateStyle: "short" }) : <span aria-hidden>—</span>}
                    {!row.newest && <span className={backupStyles.srOnly}>{t("none")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className={backupStyles.subtitle}>{t("drillTitle")}</h2>
        <p className={styles.meta}>{t("drillIntro")}</p>
        <ol className={backupStyles.steps}>
          <li>{t("drill1")}</li>
          <li>{t("drill2")}</li>
          <li>{t("drill3")}</li>
          <li>{t("drill4")}</li>
          <li>{t("drill5")}</li>
          <li>{t("drill6")}</li>
        </ol>
        <p className={styles.meta}>
          <Link href="/settings/export">{t("exportLink")}</Link>
        </p>
      </Card>
    </div>
  );
}

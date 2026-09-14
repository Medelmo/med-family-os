import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { buildExport } from "../../../../application/queries/export/buildExport";
import { Card } from "../../../../components/ui/Card";
import styles from "../settings.module.css";
import exportStyles from "./export.module.css";

/**
 * Take your data out (screen 48).
 *
 * The page's real job is not the button — it is making sure nobody is
 * surprised by what they get. Two things have to be said plainly before
 * anyone clicks:
 *
 * - **The file is not encrypted.** It is the household's records in
 *   readable text, which is the entire point of an export and also means
 *   it needs the same care as the paperwork it came from.
 * - **It contains what *you* can see**, not the household's everything. A
 *   child's export is small, and that is correct rather than broken.
 *
 * The counts are computed for real rather than estimated, by running the
 * same authorized query the download runs. It is a household-sized
 * dataset, so the cost is a page load, and the alternative is a page that
 * promises one thing and downloads another.
 */
export default async function ExportPage() {
  const { actor, householdId } = await requireActor();
  const [t, format] = await Promise.all([getTranslations("export"), getFormatter()]);

  const bundle = await buildExport(actor, householdId);
  const rows = Object.entries(bundle.counts).filter(([, count]) => count > 0);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      <Card>
        <h2 className={exportStyles.subtitle}>{t("whatYouGet")}</h2>

        {total === 0 ? (
          <p className={styles.meta}>{t("nothingToExport")}</p>
        ) : (
          <table className={exportStyles.table}>
            <caption className={exportStyles.caption}>{t("countsCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("columnKind")}</th>
                <th scope="col" className={exportStyles.numeric}>
                  {t("columnCount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([kind, count]) => (
                <tr key={kind}>
                  <th scope="row">{t(`kind.${kind}`)}</th>
                  <td className={exportStyles.numeric}>{format.number(count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Said before the download, not after: once the file exists the
            warning is too late to act on. */}
        <p className={exportStyles.warning} role="note">
          {t("plainTextWarning")}
        </p>
        <p className={styles.meta}>{t("scopeNote")}</p>

        {/* A plain link, not a form. The download is a GET that mutates
            nothing, so it needs no action, no hydration and no JavaScript
            — `download` is a hint the browser honours and the response's
            own Content-Disposition is what actually decides. */}
        <p>
          <a className={exportStyles.download} href="/api/export" download>
            {t("download")}
          </a>
        </p>
      </Card>

      <Card>
        <h2 className={exportStyles.subtitle}>{t("notABackupTitle")}</h2>
        <p className={styles.meta}>{t("notABackup")}</p>
        <p className={styles.meta}>
          <Link href="/settings/backup">{t("backupLink")}</Link>
        </p>
      </Card>
    </div>
  );
}

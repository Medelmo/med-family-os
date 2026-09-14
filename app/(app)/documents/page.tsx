import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getDocumentReferences } from "../../../application/queries/integrations/getIntegrations";
import { isSafeDocumentUrl } from "../../../domain/documents/documentReference";
import { Card } from "../../../components/ui/Card";
import styles from "./documents.module.css";

/**
 * Pointers to documents that live somewhere else.
 *
 * CLAUDE.md §13: "Do not recreate Paperless, Nextcloud or Obsidian." So
 * this page is a list of signposts — what it is, when it is from, and a
 * link out — and never a viewer. The document itself stays in the system
 * that owns it.
 */
export default async function DocumentsPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("documents");

  const references = await getDocumentReferences(actor, householdId);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {references.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
          <p className={styles.meta}>
            <Link href="/settings/integrations">{t("connectPaperless")}</Link>
          </p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {references.map((reference) => (
            <li key={reference.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <h2 className={styles.itemTitle}>
                    {/* Checked again at the point of rendering, not only on
                        import: a row could predate the check, or have been
                        written by a path that did not run it. A link is
                        the one thing on this page a person will click. */}
                    {reference.url && isSafeDocumentUrl(reference.url) ? (
                      <a href={reference.url} rel="noreferrer noopener" target="_blank">
                        {reference.title}
                      </a>
                    ) : (
                      reference.title
                    )}
                  </h2>
                  <span className={styles.provider}>{t(`provider.${reference.provider}`)}</span>
                </div>

                <p className={styles.meta}>
                  {reference.documentDate ?? t("noDate")}
                  {reference.url && isSafeDocumentUrl(reference.url) ? ` · ${t("opensElsewhere")}` : ""}
                </p>

                {reference.note && <p className={styles.note}>{reference.note}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

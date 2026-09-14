import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { getIntegrations } from "../../../../application/queries/integrations/getIntegrations";
import { authorizeIntegrationAccess } from "../../../../application/policies/integrations";
import { isKeyringConfigured } from "../../../../infrastructure/crypto/keyring";
import { Card } from "../../../../components/ui/Card";
import { ConnectForm, ReplaceTokenForm, SyncNowForm, ToggleIntegrationForm } from "./IntegrationsClient";
import styles from "./integrations.module.css";

export default async function IntegrationsPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("integrations");

  // docs/permissions.md gives integrations to Owner/Admin only — "none by
  // default" even for an adult. Anyone else gets told so rather than an
  // empty page that looks broken.
  if (!authorizeIntegrationAccess(actor, householdId)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t("title")}</h1>
        <Card>
          <p className={styles.empty}>{t("ownersOnly")}</p>
        </Card>
      </div>
    );
  }

  const integrations = await getIntegrations(actor, householdId);
  const keyringReady = isKeyringConfigured();

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {integrations.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {integrations.map((integration) => (
            <li key={integration.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <h2 className={styles.itemTitle}>{integration.displayName}</h2>
                  <span className={styles.state} data-enabled={integration.enabled}>
                    {integration.enabled ? t("stateEnabled") : t("stateDisabled")}
                  </span>
                </div>

                <p className={styles.meta}>
                  {integration.provider} · {integration.baseUrl}
                </p>

                {/* Sync health (screen 46): the last few runs, said in
                    words. "Is this working?" is answered from persisted
                    runs, not from whoever happened to be watching. */}
                <section aria-labelledby={`runs-${integration.id}`}>
                  <h3 id={`runs-${integration.id}`} className={styles.sectionHeading}>
                    {t("recentRuns")}
                  </h3>
                  {integration.recentRuns.length === 0 ? (
                    <p className={styles.meta}>{t("neverRun")}</p>
                  ) : (
                    <ul className={styles.runs}>
                      {integration.recentRuns.map((run) => (
                        <li key={run.id} className={styles.run}>
                          <span className={styles.runStatus} data-status={run.status}>
                            {t(`runStatus.${run.status}`)}
                          </span>
                          <span className={styles.meta}>
                            {t("runCounts", { imported: run.itemsImported, skipped: run.itemsSkipped })}
                            {run.finishedAt ? ` · ${run.finishedAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}
                          </span>
                          {run.errorMessage && <span className={styles.runError}>{run.errorMessage}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className={styles.actions}>
                  {integration.enabled && <SyncNowForm connectionId={integration.id} />}
                  <ToggleIntegrationForm
                    connectionId={integration.id}
                    version={integration.version}
                    enabled={integration.enabled}
                  />
                </div>

                <details className={styles.details}>
                  <summary>{t("replaceToken")}</summary>
                  <p className={styles.meta}>{t("replaceTokenHint")}</p>
                  <ReplaceTokenForm connectionId={integration.id} />
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConnectForm keyringReady={keyringReady} />
    </div>
  );
}

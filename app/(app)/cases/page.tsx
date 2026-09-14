import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getCases } from "../../../application/queries/cases/getCases";
import { OpenCaseForm } from "./CasesClient";
import { Card } from "../../../components/ui/Card";
import styles from "./cases.module.css";

export default async function CasesPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("cases");
  const list = await getCases(actor, householdId);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {list.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {list.map((kase) => (
            <li key={kase.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <h2 className={styles.itemTitle}>
                    <Link href={`/cases/${kase.id}`}>{kase.title}</Link>
                  </h2>
                  <span className={styles.status} data-status={kase.status}>
                    {t(`status.${kase.status}`)}
                  </span>
                </div>

                {/* The one line that says what happens next — the field
                    product-spec.md treats as the difference between a
                    tracked case and a forgotten one. */}
                <p className={kase.nextAction ? styles.nextAction : styles.missing}>
                  {kase.nextAction ?? t("noNextAction")}
                </p>

                {kase.status === "WAITING" && kase.waitingFor && (
                  <p className={styles.meta}>{t("waitingFor", { who: kase.waitingFor })}</p>
                )}
                {kase.status === "BLOCKED" && kase.blockedReason && (
                  <p className={styles.meta}>{t("blockedBy", { reason: kase.blockedReason })}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <OpenCaseForm />
    </div>
  );
}

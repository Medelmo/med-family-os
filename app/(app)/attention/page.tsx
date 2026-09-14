import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getAttention } from "../../../application/queries/attention/getAttention";
import { Card } from "../../../components/ui/Card";
import styles from "./attention.module.css";

export default async function AttentionPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("attention");
  const tReasons = await getTranslations("attention.reasons");
  const { items } = await getAttention(actor, householdId);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {items.length === 0 ? (
        <Card>
          {/* An empty Attention list is a real, good state — not an
              empty-data error. */}
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <Card className={styles.item}>
                <h2 className={styles.itemTitle}>{item.title}</h2>
                {/* The reasons are the point: product-spec.md forbids an
                    opaque score as the primary attention mechanism, so the
                    score orders this list but never appears in it. */}
                <ul className={styles.reasons}>
                  {item.reasons.map((reason) => (
                    <li key={reason.code} className={styles.reason} data-code={reason.code}>
                      {tReasons(reason.code, reason.context)}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

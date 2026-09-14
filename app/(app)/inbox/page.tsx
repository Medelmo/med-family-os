import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getInbox } from "../../../application/queries/inbox/getInbox";
import { CaptureBox, InboxItemRow } from "./InboxClient";
import { Card } from "../../../components/ui/Card";
import styles from "./inbox.module.css";

export default async function InboxPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("inbox");
  const items = await getInbox(actor, householdId);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      <CaptureBox />

      <p className={styles.count}>{t("untriagedCount", { count: items.length })}</p>

      {items.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <InboxItemRow item={{ id: item.id, capturedText: item.capturedText, version: item.version }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

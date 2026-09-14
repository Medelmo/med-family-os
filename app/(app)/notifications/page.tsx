import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getNotifications } from "../../../application/queries/notifications/getNotifications";
import { markAllReadAction } from "./actions";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import styles from "./notifications.module.css";

/**
 * Event types are dotted ("task.assigned") because that is the outbox's
 * naming, but next-intl treats "." in a key as a namespace separator and
 * rejects a literal dotted message key outright (INVALID_KEY). So the two
 * naming schemes are mapped here rather than one being bent to the other.
 */
type NotificationMessageKey =
  | "taskAssigned"
  | "taskFollowUpDue"
  | "caseFollowUpDue"
  | "reimbursementFollowUpDue"
  | "deadlineApproaching";

const TYPE_MESSAGE_KEYS: Record<string, NotificationMessageKey> = {
  "task.assigned": "taskAssigned",
  "task.follow_up_due": "taskFollowUpDue",
  "case.follow_up_due": "caseFollowUpDue",
  "reimbursement.follow_up_due": "reimbursementFollowUpDue",
  "deadline.approaching": "deadlineApproaching",
};

export default async function NotificationsPage() {
  const { actor } = await requireActor();
  const t = await getTranslations("notifications");
  const items = await getNotifications(actor);
  const hasUnread = items.some((item) => item.readAt === null);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t("title")}</h1>
        {hasUnread && (
          <form action={markAllReadAction}>
            <Button type="submit" variant="secondary">
              {t("markAllRead")}
            </Button>
          </form>
        )}
      </header>

      {items.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.reason}>{t(`types.${TYPE_MESSAGE_KEYS[item.type] ?? "taskAssigned"}`)}</span>
                  {/* Unread is stated in words, not only by weight or
                      colour (CLAUDE.md §13: no colour-only meaning). */}
                  {item.readAt === null && <span className={styles.unread}>{t("unread")}</span>}
                </div>
                <p className={styles.itemTitle}>{item.title}</p>
                {item.resourceType === "task" && (
                  <Link href="/tasks" className={styles.link}>
                    {t("openTask")}
                  </Link>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

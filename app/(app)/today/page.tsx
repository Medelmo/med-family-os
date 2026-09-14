import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getToday } from "../../../application/queries/attention/getAttention";
import { TaskCard } from "../../../components/tasks/TaskCard";
import { Card } from "../../../components/ui/Card";
import { toIsoDate } from "../../../domain/attention/rules";
import type { TaskListItem } from "../../../application/queries/tasks/getTasks";
import styles from "./today.module.css";

function toCardData(task: TaskListItem) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
    nextAction: task.nextAction,
    waitingFor: task.waitingFor,
    ownerName: task.ownerName,
    version: task.version,
  };
}

export default async function TodayPage() {
  const { actor, householdId, userName } = await requireActor();
  const t = await getTranslations("today");
  const tHome = await getTranslations("home");
  const format = await getFormatter();
  const { dueToday, waiting, deadlines, events } = await getToday(actor, householdId);

  const isEmpty = dueToday.length === 0 && waiting.length === 0 && deadlines.length === 0 && events.length === 0;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.greeting}>{tHome("greeting", { name: userName })}</p>
      </header>

      {isEmpty && (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      )}

      {events.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>{t("eventsSection")}</h2>
          <ul className={styles.list}>
            {events.map((event) => (
              <li key={`${event.eventId}-${event.startsAt.toISOString()}`}>
                <Card>
                  <strong>{event.title}</strong>
                  <p className={styles.meta}>
                    {event.allDay
                      ? t("allDayEvent")
                      : format.dateTime(event.startsAt, { hour: "2-digit", minute: "2-digit", timeZone: event.timeZone })}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {deadlines.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>{t("deadlinesSection")}</h2>
          <ul className={styles.list}>
            {deadlines.map((deadline) => (
              <li key={deadline.id}>
                <Card>
                  <strong>{deadline.title}</strong>
                  <p className={styles.meta}>{toIsoDate(deadline.dueOn)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dueToday.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>{t("dueSection")}</h2>
          <ul className={styles.list}>
            {dueToday.map((task) => (
              <li key={task.id}>
                <TaskCard task={toCardData(task)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>{t("waitingSection")}</h2>
          <ul className={styles.list}>
            {waiting.map((task) => (
              <li key={task.id}>
                <TaskCard task={toCardData(task)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

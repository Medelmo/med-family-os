import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getTasks } from "../../../application/queries/tasks/getTasks";
import { TaskCard } from "../../../components/tasks/TaskCard";
import { Card } from "../../../components/ui/Card";
import { toIsoDate } from "../../../domain/attention/rules";
import styles from "./tasks.module.css";

export default async function TasksPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("tasks");
  const tasks = await getTasks(actor, householdId);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("title")}</h1>

      {tasks.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskCard
                task={{
                  id: task.id,
                  title: task.title,
                  status: task.status,
                  dueOn: task.dueOn ? toIsoDate(task.dueOn) : null,
                  nextAction: task.nextAction,
                  waitingFor: task.waitingFor,
                  ownerName: task.ownerName,
                  version: task.version,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

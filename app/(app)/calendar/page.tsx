import { getFormatter, getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getCalendarOccurrences, type CalendarOccurrence } from "../../../application/queries/calendar/getCalendarEvents";
import { getHouseholdTimezone } from "../../../application/queries/tasks/getTasks";
import { instantToWallClock } from "../../../domain/calendar/timezone";
import { AddEventForm } from "./CalendarClient";
import { Card } from "../../../components/ui/Card";
import styles from "./calendar.module.css";

/** How far ahead the agenda looks. */
const HORIZON_DAYS = 60;

export default async function CalendarPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("calendar");
  const format = await getFormatter();

  const timeZone = await getHouseholdTimezone(householdId);
  const now = new Date();
  const occurrences = await getCalendarOccurrences(
    actor,
    householdId,
    now,
    new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)
  );

  // An agenda rather than a month grid: a household reads "what is coming
  // up", and a grid of mostly-empty cells answers that question worse
  // while costing far more screen room on a phone.
  const byDay = new Map<string, CalendarOccurrence[]>();
  for (const occurrence of occurrences) {
    const wall = instantToWallClock(occurrence.startsAt, occurrence.timeZone);
    const key = `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
    const existing = byDay.get(key);
    if (existing) existing.push(occurrence);
    else byDay.set(key, [occurrence]);
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description", { days: HORIZON_DAYS })}</p>
      </header>

      {byDay.size === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <Card>
          {[...byDay.entries()].map(([day, dayOccurrences]) => (
            <section key={day} className={styles.dayGroup}>
              <h2 className={styles.dayHeading}>
                {format.dateTime(new Date(`${day}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}
              </h2>
              <ul className={styles.list}>
                {dayOccurrences.map((occurrence) => (
                  <li key={`${occurrence.eventId}-${occurrence.startsAt.toISOString()}`} className={styles.row}>
                    <span className={styles.time}>
                      {occurrence.allDay
                        ? t("allDay")
                        : format.dateTime(occurrence.startsAt, { hour: "2-digit", minute: "2-digit", timeZone })}
                    </span>
                    <span className={styles.eventTitle}>{occurrence.title}</span>
                    {occurrence.location && <span className={styles.meta}>{occurrence.location}</span>}
                    {/* Recurring occurrences are labelled so a repeated
                        title doesn't read as duplicated data. */}
                    {occurrence.isRecurring && <span className={styles.meta}>{t("repeats")}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      )}

      <AddEventForm />
    </div>
  );
}

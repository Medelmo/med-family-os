import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../infrastructure/auth/currentActor";
import { getHouseholdGlance } from "../../application/queries/ha/getHouseholdGlance";
import styles from "./ha.module.css";

/**
 * The wall-tablet view, for embedding in a Home Assistant Webpage card.
 *
 * Outside the `(app)` route group on purpose: no sidebar, no bottom bar,
 * no sign-out button. A dashboard card is a few hundred pixels of glance,
 * and navigation chrome inside it is wasted space nobody can use from
 * across the room.
 *
 * **It requires a signed-in session, unlike the API endpoint.** The
 * obvious alternative — a token in the card's URL — would put a
 * long-lived credential into the reverse proxy's access log, the browser's
 * history and every screenshot of the dashboard. The tablet signs in once
 * and keeps its session; the machine-readable surface is
 * `/api/ha/summary`, where the token travels in a header.
 *
 * It renders the same projection as that endpoint, so the numbers on the
 * wall and the numbers in Home Assistant cannot disagree.
 */
export default async function HaPage() {
  const { householdId } = await requireActor();
  const t = await getTranslations("ha");
  const glance = await getHouseholdGlance(householdId);

  const tiles = [
    { key: "overdue", value: glance.overdue, tone: glance.overdue > 0 ? "critical" : "calm" },
    { key: "dueToday", value: glance.dueToday, tone: glance.dueToday > 0 ? "warning" : "calm" },
    { key: "critical", value: glance.critical, tone: glance.critical > 0 ? "critical" : "calm" },
    { key: "waiting", value: glance.waiting, tone: "calm" },
    { key: "eventsToday", value: glance.eventsToday, tone: "calm" },
  ] as const;

  return (
    <main className={styles.board}>
      <h1 className={styles.heading}>{t("title")}</h1>

      <ul className={styles.tiles}>
        {tiles.map((tile) => (
          <li key={tile.key} className={styles.tile} data-tone={tile.tone}>
            {/* The number is the point, and it has to be readable from
                across a room — but it is never alone, because a bare
                figure with a colour is not an accessible state. */}
            <span className={styles.figure}>{tile.value}</span>
            <span className={styles.label}>{t(tile.key)}</span>
          </li>
        ))}
      </ul>

      <dl className={styles.dates}>
        <dt>{t("nextDeadline")}</dt>
        <dd>{glance.nextDeadlineOn ?? t("none")}</dd>
        <dt>{t("nextTrip")}</dt>
        <dd>{glance.nextTripStartsOn ?? t("none")}</dd>
      </dl>

      {/* A stale dashboard should be visibly stale rather than quietly
          wrong — a tablet that stopped refreshing at 3am looks identical
          to one that is up to date without this. */}
      <p className={styles.footer}>
        <time dateTime={glance.generatedAt}>{t("asOf", { time: glance.generatedAt.slice(11, 16) })}</time>
        {" · "}
        <Link href="/today">{t("openApp")}</Link>
      </p>
    </main>
  );
}

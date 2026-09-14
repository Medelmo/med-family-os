import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { getTrips } from "../../../application/queries/travel/getTrips";
import { getHouseholdMembers } from "../../../application/queries/household/getHouseholdMembers";
import { getHouseholdTimezone } from "../../../application/queries/tasks/getTasks";
import { householdToday } from "../../../application/time";
import { authorizeTripAccess } from "../../../application/policies/travel";
import { Card } from "../../../components/ui/Card";
import { PlanTripForm } from "./TripsClient";
import styles from "./trips.module.css";

export default async function TripsPage() {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("trips");

  const timezone = await getHouseholdTimezone(householdId);
  const today = householdToday(timezone);

  // Decided on the server from the same policy the command enforces. This
  // is presentation, not authorization — a posted form is still refused.
  const canPlan = authorizeTripAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    createdBy: actor.userId,
    personScopeIds: [],
  });

  const [trips, members] = await Promise.all([
    getTrips(actor, householdId, today),
    canPlan ? getHouseholdMembers(actor, householdId) : Promise.resolve([]),
  ]);

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>{t("title")}</h1>
        <p className={styles.description}>{t("description")}</p>
      </header>

      {trips.length === 0 ? (
        <Card>
          <p className={styles.empty}>{t("empty")}</p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {trips.map((trip) => (
            <li key={trip.id}>
              <Card className={styles.item}>
                <div className={styles.itemHeader}>
                  <h2 className={styles.itemTitle}>
                    <Link href={`/trips/${trip.id}`}>{trip.title}</Link>
                  </h2>
                  <span className={styles.status} data-status={trip.status}>
                    {t(`status.${trip.status}`)}
                  </span>
                </div>

                <p className={styles.dates}>
                  {t("dateRange", { from: trip.startsOn, to: trip.endsOn })}
                  {trip.destination ? ` · ${trip.destination}` : ""}
                </p>

                {/* The phase is derived from today's date, never stored
                    (ADR-016). */}
                <p className={styles.meta}>
                  {t(`phase.${trip.phase}`)}
                  {trip.participants.length > 0 && ` · ${trip.participants.join(", ")}`}
                </p>

                {/* Readiness in words, so the state is never carried by
                    colour alone (CLAUDE.md §13). */}
                <p className={readinessClass(trip.readiness, styles)}>
                  {trip.readiness.unverified > 0
                    ? t("unansweredQuestions", { count: trip.readiness.unverified })
                    : trip.readiness.outstanding > 0
                      ? t("stillToDo", { count: trip.readiness.outstanding })
                      : t("ready")}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canPlan && (
        <PlanTripForm
          today={today}
          people={members.map((member) => ({ id: member.personId, name: member.displayName }))}
        />
      )}
    </div>
  );
}

function readinessClass(
  readiness: { unverified: number; outstanding: number },
  css: Record<string, string>
): string {
  if (readiness.unverified > 0) return css.readinessBlocked;
  if (readiness.outstanding > 0) return css.readinessPending;
  return css.readinessReady;
}

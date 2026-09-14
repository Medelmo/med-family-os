import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../../infrastructure/auth/currentActor";
import { getTrip, type TripItemView } from "../../../../application/queries/travel/getTrips";
import { getHouseholdMembers } from "../../../../application/queries/household/getHouseholdMembers";
import { getHouseholdTimezone } from "../../../../application/queries/tasks/getTasks";
import { householdToday } from "../../../../application/time";
import { authorizeTripAccess } from "../../../../application/policies/travel";
import { NotFoundError } from "../../../../application/errors";
import type { TripStatus } from "../../../../domain/travel/trip";
import { Card } from "../../../../components/ui/Card";
import { AddTripItemForm, ToggleItemForm, TripActionForm, VerifyItemForm } from "../TripsClient";
import styles from "../trips.module.css";

/**
 * Which actions a trip offers, mirroring ALLOWED_TRANSITIONS in
 * domain/travel/trip.ts so a dead end is never presented. The domain still
 * refuses an illegal one if posted anyway — CLAUDE.md §6, "never trust
 * client-side hiding as authorization".
 */
const ACTIONS_BY_STATUS: Record<TripStatus, { action: string; labelKey: string; withReason?: boolean }[]> = {
  PLANNED: [
    { action: "confirm", labelKey: "actionConfirm" },
    { action: "cancel", labelKey: "actionCancel", withReason: true },
  ],
  CONFIRMED: [
    { action: "unconfirm", labelKey: "actionUnconfirm", withReason: true },
    { action: "cancel", labelKey: "actionCancel", withReason: true },
    { action: "archive", labelKey: "actionArchive" },
  ],
  CANCELLED: [{ action: "archive", labelKey: "actionArchive" }],
  ARCHIVED: [],
};

export default async function TripDetailPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { actor, householdId } = await requireActor();
  const t = await getTranslations("trips");
  const { tripId } = await params;

  const timezone = await getHouseholdTimezone(householdId);
  const today = householdToday(timezone);

  let trip;
  try {
    trip = await getTrip(actor, householdId, tripId, today);
  } catch (error) {
    // A trip that is not there is a 404. An AuthorizationError is
    // deliberately not caught: "you may not see this" and "this is not
    // here" stay distinct for a household whose members all know each
    // other.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canEdit = authorizeTripAccess(actor, "update", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    createdBy: actor.userId,
    personScopeIds: [],
  });
  const members = canEdit ? await getHouseholdMembers(actor, householdId) : [];
  const people = members.map((member) => ({ id: member.personId, name: member.displayName }));

  const itinerary = trip.items.filter((item) => item.kind === "ITINERARY");
  const packing = trip.items.filter((item) => item.kind === "PACKING");
  const requirements = trip.items.filter((item) => item.kind === "ACCESSIBILITY");

  return (
    <div className={styles.page}>
      <p className={styles.breadcrumb}>
        <Link href="/trips">{t("title")}</Link>
      </p>

      <header>
        <h1 className={styles.title}>{trip.title}</h1>
        <p className={styles.status} data-status={trip.status}>
          {t(`status.${trip.status}`)}
        </p>
        <p className={styles.dates}>
          {t("dateRange", { from: trip.startsOn, to: trip.endsOn })}
          {trip.destination ? ` · ${trip.destination}` : ""}
        </p>
        <p className={styles.meta}>
          {t(`phase.${trip.phase}`)}
          {trip.participants.length > 0 && ` · ${trip.participants.join(", ")}`}
        </p>
        {trip.cancelReason && <p className={styles.meta}>{t("cancelledBecause", { reason: trip.cancelReason })}</p>}
      </header>

      {/* Access requirements come first, deliberately: they are the ones
          that cannot be fixed the night before. */}
      <section aria-labelledby="requirements-heading">
        <h2 id="requirements-heading" className={styles.subtitle}>
          {t("accessRequirements")}
        </h2>
        <Card>
          {requirements.length === 0 ? (
            <p className={styles.empty}>{t("noRequirements")}</p>
          ) : (
            <ul className={styles.plainList}>
              {requirements.map((item) => (
                <li key={item.id} className={styles.requirement}>
                  <div className={styles.requirementHeader}>
                    <span className={styles.itemLabel}>
                      {item.title}
                      {item.personName && <span className={styles.forWhom}> · {item.personName}</span>}
                    </span>
                    <span className={styles.verification} data-verification={item.verification}>
                      {t(`verification.${item.verification}`)}
                    </span>
                  </div>

                  {item.verification === "UNVERIFIED" ? (
                    canEdit && <VerifyItemForm tripId={trip.id} itemId={item.id} version={item.version} today={today} />
                  ) : (
                    // Who said so, and when. Without it the answer is just
                    // a colour.
                    <p className={styles.meta}>
                      {t("verifiedBy", { source: item.verificationSource ?? "", on: item.verifiedOn ?? "" })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <AddTripItemForm
              tripId={trip.id}
              kind="ACCESSIBILITY"
              heading={t("newRequirementLabel")}
              withDate={false}
              people={people}
            />
          )}
        </Card>
      </section>

      <ChecklistSection
        headingId="packing-heading"
        heading={t("packing")}
        emptyText={t("noPacking")}
        items={packing}
        tripId={trip.id}
        canEdit={canEdit}
        newLabel={t("newPackingLabel")}
        kind="PACKING"
        withDate={false}
        people={people}
        showDate={false}
      />

      <ChecklistSection
        headingId="itinerary-heading"
        heading={t("itinerary")}
        emptyText={t("noItinerary")}
        items={itinerary}
        tripId={trip.id}
        canEdit={canEdit}
        newLabel={t("newItineraryLabel")}
        kind="ITINERARY"
        withDate
        people={people}
        showDate
      />

      {canEdit && ACTIONS_BY_STATUS[trip.status].length > 0 && (
        <section aria-labelledby="trip-actions-heading">
          <h2 id="trip-actions-heading" className={styles.subtitle}>
            {t("whatNext")}
          </h2>
          <div className={styles.actions}>
            {ACTIONS_BY_STATUS[trip.status].map((spec) => (
              <Card key={spec.action} className={styles.actionCard}>
                <TripActionForm
                  tripId={trip.id}
                  version={trip.version}
                  action={spec.action}
                  label={t(spec.labelKey)}
                  withReason={spec.withReason}
                />
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

async function ChecklistSection({
  headingId,
  heading,
  emptyText,
  items,
  tripId,
  canEdit,
  newLabel,
  kind,
  withDate,
  people,
  showDate,
}: {
  headingId: string;
  heading: string;
  emptyText: string;
  items: TripItemView[];
  tripId: string;
  canEdit: boolean;
  newLabel: string;
  kind: string;
  withDate: boolean;
  people: { id: string; name: string }[];
  showDate: boolean;
}) {
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.subtitle}>
        {heading}
      </h2>
      <Card>
        {items.length === 0 ? (
          <p className={styles.empty}>{emptyText}</p>
        ) : (
          <ul className={styles.plainList}>
            {items.map((item) => (
              <li key={item.id} className={styles.checklistRow}>
                <span className={item.done ? styles.itemDone : styles.itemLabel}>
                  {showDate && item.onDate ? `${item.onDate} · ` : ""}
                  {item.title}
                  {item.personName && <span className={styles.forWhom}> · {item.personName}</span>}
                </span>
                {canEdit && (
                  <ToggleItemForm
                    tripId={tripId}
                    itemId={item.id}
                    version={item.version}
                    done={item.done}
                    label={item.title}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <AddTripItemForm
            tripId={tripId}
            kind={kind}
            heading={newLabel}
            withDate={withDate}
            people={people}
          />
        )}
      </Card>
    </section>
  );
}

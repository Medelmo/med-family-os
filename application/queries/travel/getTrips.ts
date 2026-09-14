import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { people, tripItems, tripParticipants, trips } from "../../../db/schema";
import { OPEN_TRIP_STATUSES, tripPhase, type TripPhase, type TripStatus } from "../../../domain/travel/trip";
import { tripReadiness, type TripItemKind, type TripReadiness, type VerificationStatus } from "../../../domain/travel/tripItem";
import { authorizeTripAccess, tripItemScope } from "../../policies/travel";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, NotFoundError } from "../../errors";

export interface TripListItem {
  id: string;
  title: string;
  destination: string | null;
  startsOn: string;
  endsOn: string;
  status: TripStatus;
  phase: TripPhase;
  participants: string[];
  readiness: TripReadiness;
  version: number;
}

export interface TripItemView {
  id: string;
  kind: TripItemKind;
  title: string;
  onDate: string | null;
  personName: string | null;
  done: boolean;
  verification: VerificationStatus;
  verificationSource: string | null;
  verifiedOn: string | null;
  notes: string | null;
  version: number;
}

export interface TripDetail extends TripListItem {
  notes: string | null;
  cancelReason: string | null;
  items: TripItemView[];
}

/**
 * Trips the actor may see, with the readiness counts the list needs.
 *
 * Readiness is computed from the items rather than stored on the trip, for
 * the same reason attention is computed: a stored counter has to be
 * maintained by every write path and is wrong the first time one forgets.
 *
 * The items are fetched in one query for all the listed trips rather than
 * one query per trip, so adding a fourth trip does not add a fourth round
 * trip.
 */
export async function getTrips(
  actor: Actor,
  householdId: string,
  todayIso: string,
  options: { statuses?: readonly TripStatus[]; limit?: number } = {}
): Promise<TripListItem[]> {
  const statuses = options.statuses ?? OPEN_TRIP_STATUSES;

  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.householdId, householdId), inArray(trips.status, [...statuses])))
    .orderBy(asc(trips.startsOn))
    .limit(options.limit ?? 100);

  if (rows.length === 0) return [];

  const tripIds = rows.map((row) => row.id);

  const [participantRows, itemRows] = await Promise.all([
    db
      .select({ tripId: tripParticipants.tripId, personId: tripParticipants.personId, name: people.displayName })
      .from(tripParticipants)
      .innerJoin(people, eq(people.id, tripParticipants.personId))
      .where(inArray(tripParticipants.tripId, tripIds)),
    db
      .select({
        tripId: tripItems.tripId,
        kind: tripItems.kind,
        done: tripItems.done,
        verification: tripItems.verification,
      })
      .from(tripItems)
      .where(inArray(tripItems.tripId, tripIds)),
  ]);

  const byTrip = <T extends { tripId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const entry of list) {
      const existing = map.get(entry.tripId);
      if (existing) existing.push(entry);
      else map.set(entry.tripId, [entry]);
    }
    return map;
  };

  const participants = byTrip(participantRows);
  const items = byTrip(itemRows);

  return rows
    .filter((row) =>
      authorizeTripAccess(actor, "read", {
        householdId: row.householdId,
        visibility: row.visibility,
        sensitivity: row.sensitivity,
        createdBy: row.createdBy,
        personScopeIds: (participants.get(row.id) ?? []).map((p) => p.personId),
      })
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      destination: row.destination,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status,
      phase: tripPhase(row, todayIso),
      participants: (participants.get(row.id) ?? []).map((p) => p.name),
      readiness: tripReadiness(items.get(row.id) ?? []),
      version: row.version,
    }));
}

export async function getTrip(
  actor: Actor,
  householdId: string,
  tripId: string,
  todayIso: string
): Promise<TripDetail> {
  const [row] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Trip not found.");

  const participantRows = await db
    .select({ personId: tripParticipants.personId, name: people.displayName })
    .from(tripParticipants)
    .innerJoin(people, eq(people.id, tripParticipants.personId))
    .where(eq(tripParticipants.tripId, tripId));

  const authorized = authorizeTripAccess(actor, "read", {
    householdId: row.householdId,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    createdBy: row.createdBy,
    personScopeIds: participantRows.map((p) => p.personId),
  });
  if (!authorized) throw new AuthorizationError("Not permitted to view this trip.");

  const itemRows = await db
    .select({ item: tripItems, personName: people.displayName })
    .from(tripItems)
    .leftJoin(people, eq(people.id, tripItems.personId))
    .where(eq(tripItems.tripId, tripId))
    .orderBy(asc(tripItems.kind), asc(tripItems.onDate), asc(tripItems.position));

  // Each item is filtered on its own scope: one naming a person is
  // narrower than the trip itself, so a reader who may see the trip does
  // not automatically see every line on it. One naming nobody belongs to
  // the trip and inherits its participants (see tripItemScope).
  const participantIds = participantRows.map((p) => p.personId);
  const visibleItems = itemRows.filter(({ item }) =>
    authorizeTripAccess(actor, "read", {
      householdId: item.householdId,
      visibility: "HOUSEHOLD",
      sensitivity: "NORMAL",
      createdBy: item.createdBy,
      personScopeIds: tripItemScope(item, participantIds),
    })
  );

  return {
    id: row.id,
    title: row.title,
    destination: row.destination,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    phase: tripPhase(row, todayIso),
    participants: participantRows.map((p) => p.name),
    // Counted from the items this reader can actually see, so the summary
    // and the list below it always agree — the same rule the finance
    // totals follow.
    readiness: tripReadiness(visibleItems.map(({ item }) => item)),
    version: row.version,
    notes: row.notes,
    cancelReason: row.cancelReason,
    items: visibleItems.map(({ item, personName }) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      onDate: item.onDate,
      personName,
      done: item.done,
      verification: item.verification,
      verificationSource: item.verificationSource,
      verifiedOn: item.verifiedOn,
      notes: item.notes,
      version: item.version,
    })),
  };
}

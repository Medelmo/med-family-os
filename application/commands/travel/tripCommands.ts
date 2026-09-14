import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { tripItems, tripParticipants, trips } from "../../../db/schema";
import { applyTripCommand, datesAreOrdered, type Trip, type TripCommand } from "../../../domain/travel/trip";
import {
  applyVerification,
  TRIP_ITEM_KINDS,
  validateNewTripItem,
  type TripItem,
} from "../../../domain/travel/tripItem";
import { getHouseholdTimezone } from "../../queries/tasks/getTasks";
import { householdToday } from "../../time";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeTripAccess, tripItemScope } from "../../policies/travel";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError, ConflictError, NotFoundError } from "../../errors";

export class TripRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TripRuleError";
    this.code = code;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

const createTripSchema = z.object({
  title: z.string().trim().min(1).max(300),
  destination: z.string().trim().max(200).nullish(),
  startsOn: isoDate,
  endsOn: isoDate,
  notes: z.string().trim().max(5000).nullish(),
  participantPersonIds: z.array(z.string().uuid()).default([]),
});

export type CreateTripInput = z.input<typeof createTripSchema>;

export async function createTrip(actor: Actor, householdId: string, input: CreateTripInput) {
  const parsed = createTripSchema.parse(input);

  if (!datesAreOrdered(parsed.startsOn, parsed.endsOn)) {
    throw new TripRuleError("DATES_OUT_OF_ORDER", "A trip cannot end before it starts.");
  }

  const authorized = authorizeTripAccess(actor, "create", {
    householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    createdBy: actor.userId,
    personScopeIds: parsed.participantPersonIds,
  });
  if (!authorized) throw new AuthorizationError("Not permitted to plan a trip in this household.");

  return db.transaction(async (tx) => {
    const [trip] = await tx
      .insert(trips)
      .values({
        householdId,
        title: parsed.title,
        destination: parsed.destination ?? null,
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn,
        notes: parsed.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();

    if (parsed.participantPersonIds.length > 0) {
      await tx
        .insert(tripParticipants)
        .values(parsed.participantPersonIds.map((personId) => ({ tripId: trip.id, personId })));
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "trip.created",
        resourceType: "trip",
        resourceId: trip.id,
      },
      tx
    );

    return trip;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadTripForUpdate(tx: Tx, actor: Actor, householdId: string, tripId: string) {
  const [row] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Trip not found.");

  const participants = await tx
    .select({ personId: tripParticipants.personId })
    .from(tripParticipants)
    .where(eq(tripParticipants.tripId, tripId));

  const authorized = authorizeTripAccess(actor, "update", {
    householdId: row.householdId,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    createdBy: row.createdBy,
    personScopeIds: participants.map((p) => p.personId),
  });
  if (!authorized) throw new AuthorizationError("Not permitted to change this trip.");

  return row;
}

/**
 * The only path by which a trip's status changes.
 *
 * The household's own "today" is resolved here and handed to the pure
 * function, which needs it to refuse archiving a trip that has not
 * happened yet. It is never inferred inside the domain (CLAUDE.md §7).
 */
export async function transitionTrip(
  actor: Actor,
  householdId: string,
  tripId: string,
  expectedVersion: number,
  command: TripCommand,
  now: Date = new Date()
) {
  const timezone = await getHouseholdTimezone(householdId);
  const todayIso = householdToday(timezone, now);

  return db.transaction(async (tx) => {
    const row = await loadTripForUpdate(tx, actor, householdId, tripId);

    const result = applyTripCommand(row as unknown as Trip, command, now, todayIso);
    if (!result.ok) throw new TripRuleError(result.rejection.code, result.rejection.message);

    const updated = await tx
      .update(trips)
      .set({ ...result.transition.patch, updatedAt: now, version: row.version + 1 })
      .where(and(eq(trips.id, tripId), eq(trips.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This trip was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: result.transition.auditAction,
        resourceType: "trip",
        resourceId: tripId,
        metadata: { from: row.status, to: result.transition.status },
      },
      tx
    );

    return updated[0];
  });
}

const addItemSchema = z.object({
  kind: z.enum(TRIP_ITEM_KINDS),
  title: z.string().trim().min(1).max(300),
  onDate: isoDate.nullish(),
  personId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export type AddTripItemInput = z.input<typeof addItemSchema>;

export async function addTripItem(actor: Actor, householdId: string, tripId: string, input: AddTripItemInput) {
  const parsed = addItemSchema.parse(input);

  return db.transaction(async (tx) => {
    const trip = await loadTripForUpdate(tx, actor, householdId, tripId);

    const validated = validateNewTripItem(
      { kind: parsed.kind, title: parsed.title, onDate: parsed.onDate ?? null, personId: parsed.personId ?? null },
      trip
    );
    if (!validated.ok) throw new TripRuleError(validated.rejection.code, validated.rejection.message);

    // Appended, not inserted: a list someone is working down should not
    // reorder itself under them.
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${tripItems.position}), 0) + 1` })
      .from(tripItems)
      .where(eq(tripItems.tripId, tripId));

    const [item] = await tx
      .insert(tripItems)
      .values({
        tripId,
        householdId,
        kind: validated.value.kind,
        title: validated.value.title,
        onDate: validated.value.onDate ?? null,
        personId: parsed.personId ?? null,
        notes: parsed.notes ?? null,
        position: next,
        createdBy: actor.userId,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "trip.item_added",
        resourceType: "trip_item",
        resourceId: item.id,
        metadata: { tripId, kind: parsed.kind },
      },
      tx
    );

    return item;
  });
}

async function loadItemForUpdate(tx: Tx, actor: Actor, householdId: string, itemId: string) {
  const [row] = await tx
    .select()
    .from(tripItems)
    .where(and(eq(tripItems.id, itemId), eq(tripItems.householdId, householdId)))
    .limit(1);

  if (!row) throw new NotFoundError("Trip item not found.");

  // An item about one person is scoped to that person, not to the whole
  // party — "Lukas needs a step-free bathroom" is health-adjacent. One
  // about nobody in particular inherits the trip's participants, so a
  // child going on the trip can tick off its packing list.
  const participants = await tx
    .select({ personId: tripParticipants.personId })
    .from(tripParticipants)
    .where(eq(tripParticipants.tripId, row.tripId));

  const authorized = authorizeTripAccess(actor, "update", {
    householdId: row.householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "NORMAL",
    createdBy: row.createdBy,
    personScopeIds: tripItemScope(row, participants.map((p) => p.personId)),
  });
  if (!authorized) throw new AuthorizationError("Not permitted to change this item.");

  return row;
}

/** Ticks a packing or itinerary line off, or back on. */
export async function setTripItemDone(
  actor: Actor,
  householdId: string,
  itemId: string,
  expectedVersion: number,
  done: boolean,
  now: Date = new Date()
) {
  return db.transaction(async (tx) => {
    const row = await loadItemForUpdate(tx, actor, householdId, itemId);

    if (row.kind === "ACCESSIBILITY") {
      throw new TripRuleError(
        "NOT_A_CHECKLIST_ITEM",
        "An access requirement is answered, not ticked off."
      );
    }

    const updated = await tx
      .update(tripItems)
      .set({ done, updatedAt: now, version: row.version + 1 })
      .where(and(eq(tripItems.id, itemId), eq(tripItems.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This item was changed by someone else. Reload and try again.");
    }

    return updated[0];
  });
}

const verifySchema = z.object({
  status: z.enum(["CONFIRMED", "REFUSED"]),
  source: z.string().trim().min(1).max(500),
  verifiedOn: isoDate,
});

export type VerifyTripItemInput = z.input<typeof verifySchema>;

/**
 * Records an answer to an access question.
 *
 * Audited, unlike ticking off a packing line: who confirmed a household's
 * accessibility needs would be met, and when, is exactly the kind of fact
 * that matters afterwards if the answer turns out to be wrong.
 */
export async function verifyTripItem(
  actor: Actor,
  householdId: string,
  itemId: string,
  expectedVersion: number,
  input: VerifyTripItemInput,
  now: Date = new Date()
) {
  const parsed = verifySchema.parse(input);

  return db.transaction(async (tx) => {
    const row = await loadItemForUpdate(tx, actor, householdId, itemId);

    const result = applyVerification(row as unknown as TripItem, parsed);
    if (!result.ok) throw new TripRuleError(result.rejection.code, result.rejection.message);

    const updated = await tx
      .update(tripItems)
      .set({ ...result.value, updatedAt: now, version: row.version + 1 })
      .where(and(eq(tripItems.id, itemId), eq(tripItems.version, expectedVersion)))
      .returning();

    if (updated.length === 0) {
      throw new ConflictError("This item was changed by someone else. Reload and try again.");
    }

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "trip.requirement_verified",
        resourceType: "trip_item",
        resourceId: itemId,
        metadata: { tripId: row.tripId, status: parsed.status },
      },
      tx
    );

    return updated[0];
  });
}

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import {
  addTripItem,
  createTrip,
  setTripItemDone,
  transitionTrip,
  verifyTripItem,
  TripRuleError,
} from "../../application/commands/travel/tripCommands";
import { getTrip, getTrips } from "../../application/queries/travel/getTrips";
import { getAttention } from "../../application/queries/attention/getAttention";
import { AuthorizationError, ConflictError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * Trips -> accessibility verification -> packing
 * (docs/implementation/implementation-plan.md vertical slice 6), against a
 * real database.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

const TODAY = "2026-06-01";
const NOW = new Date("2026-06-01T09:00:00Z");

async function household() {
  const { household, user, person } = await bootstrapHousehold({
    householdName: "Test Household",
    ownerName: "Ada Owner",
    ownerEmail: "ada@example.test",
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor, personId: person.id };
}

async function child(actor: Actor, householdId: string, email: string) {
  const person = await addHouseholdMember(actor, householdId, {
    displayName: "Lukas",
    role: "CHILD",
    account: { email, temporaryPassword: "another correct horse battery" },
  });
  return {
    actor: { userId: person.accountUserId!, householdId, role: "CHILD", personIds: [person.id] } as Actor,
    personId: person.id,
  };
}

async function aTrip(actor: Actor, householdId: string, overrides: Record<string, unknown> = {}) {
  return createTrip(actor, householdId, {
    title: "Half-term in Vienna",
    destination: "Vienna",
    startsOn: "2026-07-10",
    endsOn: "2026-07-17",
    ...overrides,
  });
}

describe("planning a trip", () => {
  it("starts as PLANNED and derives its phase from the dates", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);

    expect(trip.status).toBe("PLANNED");

    const [listed] = await getTrips(actor, householdId, TODAY);
    expect(listed).toMatchObject({ phase: "UPCOMING", destination: "Vienna" });

    // The same row reads differently on a different day — because nothing
    // about the phase is stored (ADR-016).
    const [duringTheTrip] = await getTrips(actor, householdId, "2026-07-12");
    expect(duringTheTrip.phase).toBe("CURRENT");
    const [afterwards] = await getTrips(actor, householdId, "2026-08-01");
    expect(afterwards.phase).toBe("PAST");
  });

  it("refuses a trip that ends before it starts", async () => {
    const { householdId, actor } = await household();
    await expect(aTrip(actor, householdId, { startsOn: "2026-07-17", endsOn: "2026-07-10" })).rejects.toBeInstanceOf(
      TripRuleError
    );
  });

  it("refuses a stale version rather than overwriting a concurrent change", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);
    await transitionTrip(actor, householdId, trip.id, trip.version, { type: "CONFIRM" }, NOW);

    await expect(
      transitionTrip(actor, householdId, trip.id, trip.version, { type: "CANCEL" }, NOW)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // Archiving an upcoming trip takes it off every view that exists to
  // prepare for it.
  it("will not archive a trip that has not happened yet", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);
    const confirmed = await transitionTrip(actor, householdId, trip.id, trip.version, { type: "CONFIRM" }, NOW);

    await expect(
      transitionTrip(actor, householdId, trip.id, confirmed.version, { type: "ARCHIVE" }, NOW)
    ).rejects.toMatchObject({ code: "TRIP_NOT_OVER" });
  });
});

describe("what a trip needs doing about it", () => {
  it("keeps packing, itinerary and access requirements in one list", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);

    await addTripItem(actor, householdId, trip.id, { kind: "PACKING", title: "Wheelchair charger" });
    await addTripItem(actor, householdId, trip.id, {
      kind: "ITINERARY",
      title: "Kunsthistorisches Museum",
      onDate: "2026-07-12",
    });
    await addTripItem(actor, householdId, trip.id, { kind: "ACCESSIBILITY", title: "Step-free hotel entrance" });

    const detail = await getTrip(actor, householdId, trip.id, TODAY);
    expect(detail.items).toHaveLength(3);
    expect(detail.readiness).toMatchObject({ outstanding: 2, unverified: 1, refused: 0, total: 3 });
  });

  it("refuses an itinerary day outside the trip", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);

    await expect(
      addTripItem(actor, householdId, trip.id, { kind: "ITINERARY", title: "Museum", onDate: "2026-07-20" })
    ).rejects.toMatchObject({ code: "DATE_OUTSIDE_TRIP" });
  });

  it("ticks a packing line off and back on", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);
    const item = await addTripItem(actor, householdId, trip.id, { kind: "PACKING", title: "Medication" });

    const done = await setTripItemDone(actor, householdId, item.id, item.version, true, NOW);
    expect(done.done).toBe(true);
    expect((await getTrip(actor, householdId, trip.id, TODAY)).readiness.outstanding).toBe(0);

    const undone = await setTripItemDone(actor, householdId, item.id, done.version, false, NOW);
    expect(undone.done).toBe(false);
  });

  it("will not let an access requirement be ticked off instead of answered", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);
    const item = await addTripItem(actor, householdId, trip.id, { kind: "ACCESSIBILITY", title: "Lift to the room" });

    await expect(setTripItemDone(actor, householdId, item.id, item.version, true, NOW)).rejects.toMatchObject({
      code: "NOT_A_CHECKLIST_ITEM",
    });
  });
});

describe("verifying an access requirement", () => {
  async function requirement() {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);
    const item = await addTripItem(actor, householdId, trip.id, {
      kind: "ACCESSIBILITY",
      title: "Step-free hotel entrance",
    });
    return { householdId, actor, trip, item };
  }

  it("records who said so and when", async () => {
    const { householdId, actor, trip, item } = await requirement();

    await verifyTripItem(
      actor,
      householdId,
      item.id,
      item.version,
      { status: "CONFIRMED", source: "Phoned the hotel, spoke to Frau Müller", verifiedOn: "2026-06-01" },
      NOW
    );

    const detail = await getTrip(actor, householdId, trip.id, TODAY);
    expect(detail.items[0]).toMatchObject({
      verification: "CONFIRMED",
      verificationSource: "Phoned the hotel, spoke to Frau Müller",
      verifiedOn: "2026-06-01",
    });
    expect(detail.readiness.unverified).toBe(0);
  });

  // Being told "no" is information the household can act on, not an
  // unfinished task to be nagged about.
  it("treats a refusal as an answer, not an open question", async () => {
    const { householdId, actor, trip, item } = await requirement();

    await verifyTripItem(
      actor,
      householdId,
      item.id,
      item.version,
      { status: "REFUSED", source: "They said the lift is out until autumn", verifiedOn: "2026-06-01" },
      NOW
    );

    const detail = await getTrip(actor, householdId, trip.id, TODAY);
    expect(detail.readiness).toMatchObject({ unverified: 0, refused: 1 });
  });

  it("refuses an answer with no source", async () => {
    const { householdId, actor, item } = await requirement();

    await expect(
      verifyTripItem(actor, householdId, item.id, item.version, {
        status: "CONFIRMED",
        source: "   ",
        verifiedOn: "2026-06-01",
      })
    ).rejects.toThrow();
  });
});

describe("a trip on the attention list", () => {
  // product-spec.md lists "trip readiness" as an attention trigger.
  it("surfaces an unanswered access question once the window opens", async () => {
    const { householdId, actor } = await household();
    // Two weeks out, inside the 21-day preparation window.
    const trip = await aTrip(actor, householdId, { startsOn: "2026-06-15", endsOn: "2026-06-22" });
    await addTripItem(actor, householdId, trip.id, { kind: "ACCESSIBILITY", title: "Step-free entrance" });
    await addTripItem(actor, householdId, trip.id, { kind: "PACKING", title: "Charger" });

    const { items } = await getAttention(actor, householdId, NOW);
    const surfaced = items.find((item) => item.id === trip.id);

    expect(surfaced?.kind).toBe("trip");
    const codes = surfaced?.reasons.map((r) => r.code) ?? [];
    expect(codes).toContain("UNVERIFIED_FACTS");
    expect(codes).toContain("PREPARATION_INCOMPLETE");
  });

  it("says nothing about a trip that is months away", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId, { startsOn: "2026-12-01", endsOn: "2026-12-08" });
    await addTripItem(actor, householdId, trip.id, { kind: "PACKING", title: "Charger" });

    const { items } = await getAttention(actor, householdId, NOW);
    expect(items.find((item) => item.id === trip.id)).toBeUndefined();
  });

  it("says nothing about a trip that is fully prepared", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId, { startsOn: "2026-06-15", endsOn: "2026-06-22" });
    const item = await addTripItem(actor, householdId, trip.id, { kind: "PACKING", title: "Charger" });
    await setTripItemDone(actor, householdId, item.id, item.version, true, NOW);

    const { items } = await getAttention(actor, householdId, NOW);
    expect(items.find((entry) => entry.id === trip.id)).toBeUndefined();
  });
});

describe("who may see a trip", () => {
  // docs/permissions.md gives a CHILD a "participant-safe view", and the
  // participant list is what delivers it: a child sees a trip because they
  // are named as going on it.
  it("lets a child see a trip they are going on", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid@example.test");
    const trip = await aTrip(actor, householdId, { participantPersonIds: [kid.personId] });
    await addTripItem(actor, householdId, trip.id, { kind: "ITINERARY", title: "Museum", onDate: "2026-07-12" });

    const visible = await getTrips(kid.actor, householdId, TODAY);
    expect(visible.map((t) => t.id)).toContain(trip.id);
    expect((await getTrip(kid.actor, householdId, trip.id, TODAY)).items).toHaveLength(1);
  });

  // The flip side, and the one that surprised this implementation's first
  // draft: a trip nobody has been added to is a trip nobody has been told
  // they are going on, so no child sees it.
  it("hides a trip with no participants from a child", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid1b@example.test");
    const trip = await aTrip(actor, householdId);

    expect(await getTrips(kid.actor, householdId, TODAY)).toEqual([]);
    await expect(getTrip(kid.actor, householdId, trip.id, TODAY)).rejects.toBeInstanceOf(AuthorizationError);
  });

  // An item naming one person is narrower than the trip itself.
  it("hides an item about another person from a child", async () => {
    const { householdId, actor, personId } = await household();
    const kid = await child(actor, householdId, "kid2@example.test");
    const trip = await aTrip(actor, householdId, { participantPersonIds: [kid.personId] });

    await addTripItem(actor, householdId, trip.id, {
      kind: "ACCESSIBILITY",
      title: "Ada needs a ground-floor room",
      personId,
    });
    await addTripItem(actor, householdId, trip.id, {
      kind: "PACKING",
      title: "Lukas's inhaler",
      personId: kid.personId,
    });

    const detail = await getTrip(kid.actor, householdId, trip.id, TODAY);
    expect(detail.items.map((i) => i.title)).toEqual(["Lukas's inhaler"]);
    // The summary counts only what this reader can see, so it agrees with
    // the list underneath it.
    expect(detail.readiness.total).toBe(1);
  });

  // The same scoping rule on the write path: a child going on the trip
  // can tick off its packing list, which is the point of giving them one.
  it("lets a child participant tick off a shared packing line", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid1c@example.test");
    const trip = await aTrip(actor, householdId, { participantPersonIds: [kid.personId] });
    const item = await addTripItem(actor, householdId, trip.id, { kind: "PACKING", title: "Sun cream" });

    const done = await setTripItemDone(kid.actor, householdId, item.id, item.version, true, NOW);
    expect(done.done).toBe(true);
  });

  it("still refuses a child an item scoped to somebody else", async () => {
    const { householdId, actor, personId } = await household();
    const kid = await child(actor, householdId, "kid1d@example.test");
    const trip = await aTrip(actor, householdId, { participantPersonIds: [kid.personId] });
    const item = await addTripItem(actor, householdId, trip.id, {
      kind: "PACKING",
      title: "Ada's passport",
      personId,
    });

    await expect(
      setTripItemDone(kid.actor, householdId, item.id, item.version, true, NOW)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses a trip from another household", async () => {
    const { householdId, actor } = await household();
    const trip = await aTrip(actor, householdId);
    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    await expect(getTrip(outsider, householdId, trip.id, TODAY)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await getTrips(outsider, householdId, TODAY)).toEqual([]);
  });

  it("reports a missing trip as not found", async () => {
    const { householdId, actor } = await household();
    await expect(
      getTrip(actor, householdId, "00000000-0000-7000-8000-000000000000", TODAY)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

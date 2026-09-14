import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../support/database";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import {
  addMaintenanceRecord,
  addWarranty,
  createAsset,
  disposeAsset,
  AssetRuleError,
} from "../../application/commands/assets/assetCommands";
import { getAsset, getAssets } from "../../application/queries/assets/getAssets";
import { getAttention } from "../../application/queries/attention/getAttention";
import { AuthorizationError, ConflictError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";

/**
 * Assets -> warranty -> maintenance
 * (docs/implementation/implementation-plan.md vertical slice 7), against a
 * real database.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

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

describe("recording an asset", () => {
  it("parses the price with the same money rule as everything else", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, {
      name: "Washing machine",
      category: "APPLIANCE",
      purchasePrice: "1.249,99",
    });

    expect(asset.purchasePriceMinor).toBe(124999);
    expect(asset.currency).toBe("EUR");
  });

  it("stores no currency when no price was given", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Bookshelf" });
    expect(asset.purchasePriceMinor).toBeNull();
    expect(asset.currency).toBeNull();
  });

  it("refuses a price it cannot read", async () => {
    const { householdId, actor } = await household();
    await expect(
      createAsset(actor, householdId, { name: "Washing machine", purchasePrice: "about a grand" })
    ).rejects.toBeInstanceOf(AssetRuleError);
  });

  // The safe answer has to be the automatic one (ADR-017).
  it("raises a medical or mobility asset to SENSITIVE without being asked", async () => {
    const { householdId, actor } = await household();
    const chair = await createAsset(actor, householdId, { name: "Wheelchair", category: "MOBILITY" });
    const dishwasher = await createAsset(actor, householdId, { name: "Dishwasher", category: "APPLIANCE" });

    expect(chair.sensitivity).toBe("SENSITIVE");
    expect(dishwasher.sensitivity).toBe("NORMAL");
  });
});

describe("warranties", () => {
  it("reports the latest end date across overlapping cover", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Washing machine" });

    await addWarranty(actor, householdId, asset.id, {
      provider: "MediaMarkt",
      startsOn: "2026-01-01",
      endsOn: "2027-01-01",
    });
    await addWarranty(actor, householdId, asset.id, {
      provider: "Miele",
      startsOn: "2026-01-01",
      endsOn: "2029-01-01",
    });

    const detail = await getAsset(actor, householdId, asset.id);
    expect(detail.coverEndsOn).toBe("2029-01-01");
    expect(detail.warranties).toHaveLength(2);
  });

  it("refuses cover with nobody on the hook", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Washing machine" });

    await expect(
      addWarranty(actor, householdId, asset.id, { provider: "  ", startsOn: "2026-01-01", endsOn: "2027-01-01" })
    ).rejects.toThrow();
  });

  it("refuses cover that ends before it starts", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Washing machine" });

    await expect(
      addWarranty(actor, householdId, asset.id, { provider: "Miele", startsOn: "2027-01-01", endsOn: "2026-01-01" })
    ).rejects.toMatchObject({ code: "WARRANTY_DATES_OUT_OF_ORDER" });
  });
});

describe("maintenance", () => {
  it("takes the next due date from the most recent service", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Boiler" });

    await addMaintenanceRecord(
      actor,
      householdId,
      asset.id,
      { performedOn: "2026-02-01", summary: "Annual service", nextDueOn: "2027-02-01" },
      NOW
    );
    await addMaintenanceRecord(
      actor,
      householdId,
      asset.id,
      { performedOn: "2026-05-15", summary: "Replaced the pump", nextDueOn: "2027-05-15" },
      NOW
    );

    const detail = await getAsset(actor, householdId, asset.id);
    expect(detail.nextServiceDueOn).toBe("2027-05-15");
    expect(detail.maintenance).toHaveLength(2);
  });

  // A service record is a record of something that happened.
  it("refuses a service dated in the future", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Boiler" });

    await expect(
      addMaintenanceRecord(actor, householdId, asset.id, { performedOn: "2026-07-01", summary: "Service" }, NOW)
    ).rejects.toMatchObject({ code: "MAINTENANCE_IN_FUTURE" });
  });

  it("refuses a next service due before the one being recorded", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Boiler" });

    await expect(
      addMaintenanceRecord(
        actor,
        householdId,
        asset.id,
        { performedOn: "2026-05-01", summary: "Service", nextDueOn: "2026-04-01" },
        NOW
      )
    ).rejects.toMatchObject({ code: "NEXT_DUE_BEFORE_PERFORMED" });
  });
});

describe("disposal", () => {
  it("takes a disposed asset off the list and out of attention", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Old dryer" });
    await addWarranty(actor, householdId, asset.id, {
      provider: "MediaMarkt",
      startsOn: "2026-01-01",
      endsOn: "2026-06-20",
    });

    // Cover ending in 19 days is inside the 30-day window, so it is on the
    // list before disposal...
    const before = await getAttention(actor, householdId, NOW);
    expect(before.items.map((i) => i.id)).toContain(asset.id);

    await disposeAsset(actor, householdId, asset.id, asset.version, { disposedOn: "2026-06-01" }, NOW);

    // ...and a warranty on a machine that is gone is not something anybody
    // needs reminding about.
    expect((await getAssets(actor, householdId)).map((a) => a.id)).not.toContain(asset.id);
    const after = await getAttention(actor, householdId, NOW);
    expect(after.items.map((i) => i.id)).not.toContain(asset.id);
  });

  it("is still findable when asked for", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Old dryer" });
    await disposeAsset(actor, householdId, asset.id, asset.version, { disposedOn: "2026-06-01" }, NOW);

    const listed = await getAssets(actor, householdId, { includeDisposed: true });
    expect(listed.map((a) => a.id)).toContain(asset.id);
  });

  it("happens once", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Old dryer" });
    const disposed = await disposeAsset(actor, householdId, asset.id, asset.version, { disposedOn: "2026-06-01" }, NOW);

    await expect(
      disposeAsset(actor, householdId, asset.id, disposed.version, { disposedOn: "2026-06-02" }, NOW)
    ).rejects.toMatchObject({ code: "ALREADY_DISPOSED" });
  });

  // A second, sequential attempt is caught by ALREADY_DISPOSED before the
  // version check ever runs, and that order is the right one: "this is
  // already gone" tells the household more than "someone else changed
  // it". The version check is for the genuine race below.
  it("lets exactly one of two simultaneous disposals win", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Old dryer" });

    const results = await Promise.allSettled([
      disposeAsset(actor, householdId, asset.id, asset.version, { disposedOn: "2026-06-01" }, NOW),
      disposeAsset(actor, householdId, asset.id, asset.version, { disposedOn: "2026-06-02" }, NOW),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((r) => r.status === "rejected");
    // Either guard is a correct refusal; what matters is that the second
    // write did not silently overwrite the first.
    expect(
      rejection?.reason instanceof ConflictError || (rejection?.reason as AssetRuleError)?.code === "ALREADY_DISPOSED"
    ).toBe(true);
  });
});

describe("an asset on the attention list", () => {
  // product-spec.md names "upcoming warranty" as an attention trigger.
  it("surfaces cover about to lapse, with the days left", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Washing machine" });
    await addWarranty(actor, householdId, asset.id, {
      provider: "Miele",
      startsOn: "2023-06-20",
      endsOn: "2026-06-20",
    });

    const { items } = await getAttention(actor, householdId, NOW);
    const surfaced = items.find((i) => i.id === asset.id);

    expect(surfaced?.kind).toBe("asset");
    expect(surfaced?.reasons).toContainEqual({ code: "COVER_ENDING", context: { daysUntilExpiry: 19 } });
  });

  // Nothing left to do once it has lapsed.
  it("goes quiet once cover has already lapsed", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Washing machine" });
    await addWarranty(actor, householdId, asset.id, {
      provider: "Miele",
      startsOn: "2022-01-01",
      endsOn: "2025-01-01",
    });

    const { items } = await getAttention(actor, householdId, NOW);
    expect(items.find((i) => i.id === asset.id)).toBeUndefined();
  });

  it("surfaces an overdue service", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Boiler" });
    await addMaintenanceRecord(
      actor,
      householdId,
      asset.id,
      { performedOn: "2025-05-01", summary: "Annual service", nextDueOn: "2026-05-01" },
      NOW
    );

    const { items } = await getAttention(actor, householdId, NOW);
    const surfaced = items.find((i) => i.id === asset.id);
    expect(surfaced?.reasons.map((r) => r.code)).toContain("OVERDUE");
  });

  it("says nothing about an asset with no dates on it at all", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Bookshelf" });

    const { items } = await getAttention(actor, householdId, NOW);
    expect(items.find((i) => i.id === asset.id)).toBeUndefined();
  });
});

describe("who may see an asset", () => {
  // docs/permissions.md gives a CHILD "explicit" access to assets — not
  // the "participant-safe view" trips get. A child sees the things that
  // are theirs, and nothing else the household owns.
  it("shows a child their own things and not the household ones", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid@example.test");

    await createAsset(actor, householdId, { name: "Dishwasher", category: "APPLIANCE" });
    await createAsset(actor, householdId, {
      name: "School laptop",
      category: "ELECTRONICS",
      personId: kid.personId,
    });

    expect((await getAssets(kid.actor, householdId)).map((a) => a.name)).toEqual(["School laptop"]);
  });

  // Sensitivity is the second, independent gate: even an asset scoped to
  // the child is refused if it is MEDICAL or MOBILITY, because owning one
  // says something about their health.
  it("hides a mobility aid from a child even when it is theirs", async () => {
    const { householdId, actor } = await household();
    const kid = await child(actor, householdId, "kid2@example.test");

    const chair = await createAsset(actor, householdId, {
      name: "Wheelchair",
      category: "MOBILITY",
      personId: kid.personId,
    });

    expect(await getAssets(kid.actor, householdId)).toEqual([]);
    await expect(getAsset(kid.actor, householdId, chair.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets a viewer read but not write", async () => {
    const { householdId, actor } = await household();
    await createAsset(actor, householdId, { name: "Dishwasher" });

    const viewer: Actor = { userId: actor.userId, householdId, role: "VIEWER", personIds: [] };
    expect(await getAssets(viewer, householdId)).toHaveLength(1);
    await expect(createAsset(viewer, householdId, { name: "Toaster" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses an asset from another household", async () => {
    const { householdId, actor } = await household();
    const asset = await createAsset(actor, householdId, { name: "Dishwasher" });
    const outsider: Actor = { ...actor, householdId: "00000000-0000-7000-8000-00000000ffff" };

    await expect(getAsset(outsider, householdId, asset.id)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await getAssets(outsider, householdId)).toEqual([]);
  });
});

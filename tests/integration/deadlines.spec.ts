import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import { auditEvents, cases, deadlines, households } from "../../db/schema";
import { bootstrapHousehold } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { createDeadline } from "../../application/commands/deadlines/createDeadline";
import { createCase } from "../../application/commands/cases/createCase";
import { AuthorizationError, NotFoundError } from "../../application/errors";
import type { Actor } from "../../application/policies/authorize";
import { resetDatabase } from "../support/database";

/**
 * Recording a date the household is committed to.
 *
 * The aggregate could be read, ranked by the attention rules and announced
 * by the reminder scan long before anything could create one — every one
 * of those paths seeded its rows directly. These are the first tests that
 * exercise a deadline arriving the way a household actually produces one.
 */

beforeEach(resetDatabase);
afterAll(resetDatabase);

async function household(seed = "a") {
  const { household, user, person } = await bootstrapHousehold({
    householdName: `Household ${seed}`,
    ownerName: "Ada Owner",
    ownerEmail: `ada.${seed}@example.test`,
    ownerPassword: "correct horse battery staple",
  });
  const actor: Actor = { userId: user.id, householdId: household.id, role: "OWNER", personIds: [person.id] };
  return { householdId: household.id, actor };
}

describe("createDeadline", () => {
  it("records the date as a day, not an instant", async () => {
    const { householdId, actor } = await household();

    const created = await createDeadline(actor, householdId, {
      title: "Widerspruchsfrist AOK Zuggerät",
      dueOn: "2026-10-14",
    });

    const [row] = await db.select().from(deadlines).where(eq(deadlines.id, created.id));

    // The column is a DATE. Asserting the ISO day rather than an instant is
    // the point: a Frist falls on a day, and a test comparing timestamps
    // would pass in one timezone and fail in another.
    expect(row.dueOn.toISOString().slice(0, 10)).toBe("2026-10-14");
    expect(row.metAt).toBeNull();
    expect(row.remindedForDueOn).toBeNull();
  });

  it("writes an audit event naming the account that recorded it", async () => {
    const { householdId, actor } = await household();

    const created = await createDeadline(actor, householdId, { title: "Klagefrist", dueOn: "2026-09-03" });

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.resourceId, created.id), eq(auditEvents.action, "deadline.created")));

    expect(event).toBeDefined();
    expect(event.actorUserId).toBe(actor.userId);
  });

  it("carries visibility and sensitivity through to the row", async () => {
    const { householdId, actor } = await household();

    const created = await createDeadline(actor, householdId, {
      title: "Befundtermin",
      dueOn: "2026-11-02",
      visibility: "PRIVATE",
      sensitivity: "HIGHLY_SENSITIVE",
    });

    const [row] = await db.select().from(deadlines).where(eq(deadlines.id, created.id));
    expect(row.visibility).toBe("PRIVATE");
    expect(row.sensitivity).toBe("HIGHLY_SENSITIVE");
  });

  it("links to a case in the same household", async () => {
    const { householdId, actor } = await household();
    const kase = await createCase(actor, householdId, { title: "Kraftfahrzeughilfe" });

    const created = await createDeadline(actor, householdId, {
      title: "Widerspruchsfrist",
      dueOn: "2026-10-14",
      caseId: kase.id,
    });

    const [row] = await db.select().from(deadlines).where(eq(deadlines.id, created.id));
    expect(row.caseId).toBe(kase.id);
  });

  /*
   * The one that matters.
   *
   * `caseId` arrives from the caller, and the threat model treats an object
   * id from outside as hostile by default. Without the ownership check a
   * deadline could be stapled onto another household's case by guessing a
   * uuid — a cross-household write, and a read channel too, because that
   * household's case page would then display it.
   */
  it("refuses to link a case belonging to another household", async () => {
    const mine = await household();

    // ADR-012 allows exactly one bootstrap, so the second household's rows
    // go in directly — the same reason and the same approach as
    // ha-projection.spec.ts. What is under test is the ownership check,
    // not how the other household came to exist.
    const [other] = await db.insert(households).values({ name: "Someone else" }).returning();
    const [theirCase] = await db
      .insert(cases)
      .values({ householdId: other.id, title: "Not yours", status: "ACTIVE" })
      .returning();

    await expect(
      createDeadline(mine.actor, mine.householdId, {
        title: "Attempted cross-household link",
        dueOn: "2026-10-14",
        caseId: theirCase.id,
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    // And nothing was written on the way to refusing.
    const rows = await db.select().from(deadlines).where(eq(deadlines.householdId, mine.householdId));
    expect(rows).toHaveLength(0);
  });

  it("refuses a viewer", async () => {
    const { householdId, actor } = await household();
    const viewerPerson = await addHouseholdMember(actor, householdId, {
      displayName: "Val Viewer",
      role: "VIEWER",
      account: { email: "val@example.test", temporaryPassword: "a long enough password" },
    });

    const viewer: Actor = { userId: viewerPerson.accountUserId!, householdId, role: "VIEWER", personIds: [] };

    await expect(
      createDeadline(viewer, householdId, { title: "Nope", dueOn: "2026-10-14" })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a date that is not an ISO date", async () => {
    const { householdId, actor } = await household();
    await expect(createDeadline(actor, householdId, { title: "Bad", dueOn: "14.10.2026" })).rejects.toThrow();
  });
});

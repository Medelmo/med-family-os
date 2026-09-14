import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../infrastructure/db/client";
import {
  auditEvents,
  deadlines,
  households,
  householdMemberships,
  inboxItems,
  notifications,
  outboxEvents,
  people,
  sessionRevocations,
  taskPeople,
  tasks,
  users,
} from "../../db/schema";
import { bootstrapHousehold, BootstrapNotAllowedError } from "../../application/commands/household/bootstrapHousehold";
import { addHouseholdMember } from "../../application/commands/household/addHouseholdMember";
import { getHouseholdMembers } from "../../application/queries/household/getHouseholdMembers";
import { AuthorizationError } from "../../application/errors";

/**
 * Exercises the Phase 1 vertical slice (authentication -> household ->
 * person -> policy -> audit) against a real PostgreSQL instance, per
 * CLAUDE.md §25 "Integration tests: Database behavior, repositories,
 * transactions". Requires DATABASE_URL to point at a disposable
 * development database — this test truncates every domain table before
 * each case. Bring one up with:
 *   docker compose up -d db   (docker-compose.override.yml publishes the
 *   port to localhost for local dev; see that file's comment)
 *   pnpm db:migrate
 */

async function resetDatabase() {
  await db.execute(
    sql`truncate table ${notifications}, ${outboxEvents}, ${auditEvents}, ${deadlines}, ${taskPeople}, ${tasks}, ${inboxItems}, ${people}, ${householdMemberships}, ${households}, ${sessionRevocations}, ${users} cascade`
  );
}

beforeEach(resetDatabase);
afterAll(resetDatabase);

describe("household bootstrap + membership (integration)", () => {
  it("creates the first OWNER, household, membership and person", async () => {
    const result = await bootstrapHousehold({
      householdName: "Test Household",
      ownerName: "Ada Owner",
      ownerEmail: "ada@example.test",
      ownerPassword: "correct horse battery staple",
    });

    expect(result.household.name).toBe("Test Household");
    expect(result.membership.role).toBe("OWNER");
    expect(result.person.accountUserId).toBe(result.user.id);

    const [auditRow] = await db.select().from(auditEvents).where(sql`action = 'household.bootstrapped'`);
    expect(auditRow).toBeDefined();
    expect(auditRow.householdId).toBe(result.household.id);
  });

  it("rejects a second bootstrap attempt", async () => {
    await bootstrapHousehold({
      householdName: "First",
      ownerName: "Ada",
      ownerEmail: "ada@example.test",
      ownerPassword: "correct horse battery staple",
    });

    await expect(
      bootstrapHousehold({
        householdName: "Second",
        ownerName: "Bea",
        ownerEmail: "bea@example.test",
        ownerPassword: "correct horse battery staple",
      })
    ).rejects.toBeInstanceOf(BootstrapNotAllowedError);
  });

  it("lets an OWNER add a household member with and without a login", async () => {
    const { household, user: owner } = await bootstrapHousehold({
      householdName: "Test Household",
      ownerName: "Ada Owner",
      ownerEmail: "ada@example.test",
      ownerPassword: "correct horse battery staple",
    });
    const ownerActor = { userId: owner.id, householdId: household.id, role: "OWNER" as const, personIds: [] };

    const childPerson = await addHouseholdMember(ownerActor, household.id, {
      displayName: "Kid",
      role: "CHILD",
    });
    expect(childPerson.accountUserId).toBeNull();

    const adultPerson = await addHouseholdMember(ownerActor, household.id, {
      displayName: "Ben Adult",
      role: "ADULT",
      account: { email: "ben@example.test", temporaryPassword: "another long temp password" },
    });
    expect(adultPerson.accountUserId).not.toBeNull();

    const members = await getHouseholdMembers(ownerActor, household.id);
    expect(members).toHaveLength(3); // owner + child + adult
    expect(members.find((m) => m.displayName === "Kid")?.hasAccount).toBe(false);
    expect(members.find((m) => m.displayName === "Ben Adult")?.hasAccount).toBe(true);
  });

  it("rejects a non-OWNER/ADMIN actor adding a household member (ADR-012)", async () => {
    const { household, user: owner } = await bootstrapHousehold({
      householdName: "Test Household",
      ownerName: "Ada Owner",
      ownerEmail: "ada@example.test",
      ownerPassword: "correct horse battery staple",
    });
    const ownerActor = { userId: owner.id, householdId: household.id, role: "OWNER" as const, personIds: [] };
    const adultPerson = await addHouseholdMember(ownerActor, household.id, {
      displayName: "Ben Adult",
      role: "ADULT",
      account: { email: "ben@example.test", temporaryPassword: "another long temp password" },
    });

    const adultActor = {
      userId: adultPerson.accountUserId!,
      householdId: household.id,
      role: "ADULT" as const,
      personIds: [adultPerson.id],
    };

    await expect(
      addHouseholdMember(adultActor, household.id, { displayName: "Someone else", role: "VIEWER" })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

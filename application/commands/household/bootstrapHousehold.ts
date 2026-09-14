import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { users, households, householdMemberships, people } from "../../../db/schema";
import { hashPassword } from "../../../infrastructure/auth/password";
import { recordAuditEvent } from "../../audit/recordAuditEvent";

// 12 chars minimum: OWASP ASVS 5.0.0 v2.1.1 baseline for a memorized secret
// with no additional composition rules forced on the user.
const bootstrapInputSchema = z.object({
  householdName: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1).max(200),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerPassword: z.string().min(12).max(200),
});

export type BootstrapHouseholdInput = z.infer<typeof bootstrapInputSchema>;

export class BootstrapNotAllowedError extends Error {
  constructor() {
    super("Setup is only available before the first account exists.");
    this.name = "BootstrapNotAllowedError";
  }
}

/**
 * First-run setup: creates the first OWNER account, household, membership,
 * and linked person, in one transaction. Deliberately not a public
 * self-registration endpoint (ADR-012) — every household member after the
 * first is created by an OWNER/ADMIN via addHouseholdMember, not by
 * visiting a sign-up page. Reachable only while zero UserAccounts exist;
 * that check runs inside the same transaction as the inserts so two
 * concurrent first visits can't both "win" the bootstrap race.
 */
export async function bootstrapHousehold(input: BootstrapHouseholdInput) {
  const parsed = bootstrapInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
    if (count > 0) {
      throw new BootstrapNotAllowedError();
    }

    const passwordHash = await hashPassword(parsed.ownerPassword);
    const [user] = await tx
      .insert(users)
      .values({ name: parsed.ownerName, email: parsed.ownerEmail, passwordHash })
      .returning();
    const [household] = await tx.insert(households).values({ name: parsed.householdName }).returning();
    const [membership] = await tx
      .insert(householdMemberships)
      .values({ householdId: household.id, userId: user.id, role: "OWNER" })
      .returning();
    const [person] = await tx
      .insert(people)
      .values({ householdId: household.id, accountUserId: user.id, displayName: parsed.ownerName })
      .returning();

    await recordAuditEvent(
      {
        householdId: household.id,
        actorUserId: user.id,
        action: "household.bootstrapped",
        resourceType: "household",
        resourceId: household.id,
      },
      tx
    );

    return { user, household, membership, person };
  });
}

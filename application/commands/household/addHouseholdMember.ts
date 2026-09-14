import { z } from "zod";
import { db } from "../../../infrastructure/db/client";
import { users, householdMemberships, people } from "../../../db/schema";
import { hashPassword } from "../../../infrastructure/auth/password";
import { recordAuditEvent } from "../../audit/recordAuditEvent";
import { authorizeAddHouseholdMember } from "../../policies/household";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

const addMemberInputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  role: z.enum(["ADMIN", "ADULT", "CHILD", "VIEWER"]),
  dateOfBirth: z.coerce.date().optional(),
  // A CHILD or a non-login family member (e.g. a baby) can exist as a
  // Person with no account at all — see domain/family/person.ts. Providing
  // email+password creates a login; omitting them creates a person-only
  // record an OWNER/ADMIN manages on that member's behalf.
  account: z
    .object({
      email: z.string().trim().toLowerCase().email(),
      temporaryPassword: z.string().min(12).max(200),
    })
    .optional(),
});

// z.input, not z.infer — see createCase.ts for why.
export type AddHouseholdMemberInput = z.input<typeof addMemberInputSchema>;

/**
 * Adds a new household member. OWNER/ADMIN only (ADR-012: no public
 * self-registration — every account after the first is created here, by an
 * existing OWNER/ADMIN, not via a sign-up form).
 */
export async function addHouseholdMember(actor: Actor, householdId: string, input: AddHouseholdMemberInput) {
  if (!authorizeAddHouseholdMember(actor, householdId)) {
    throw new AuthorizationError("Not permitted to add a household member.");
  }

  const parsed = addMemberInputSchema.parse(input);

  return db.transaction(async (tx) => {
    let accountUserId: string | null = null;

    if (parsed.account) {
      const passwordHash = await hashPassword(parsed.account.temporaryPassword);
      const [user] = await tx
        .insert(users)
        .values({ name: parsed.displayName, email: parsed.account.email, passwordHash })
        .returning();
      accountUserId = user.id;

      await tx.insert(householdMemberships).values({ householdId, userId: user.id, role: parsed.role });
    }

    const [person] = await tx
      .insert(people)
      .values({
        householdId,
        accountUserId,
        displayName: parsed.displayName,
        dateOfBirth: parsed.dateOfBirth,
      })
      .returning();

    await recordAuditEvent(
      {
        householdId,
        actorUserId: actor.userId,
        action: "household.member_added",
        resourceType: "person",
        resourceId: person.id,
        metadata: { role: parsed.role, hasAccount: accountUserId !== null },
      },
      tx
    );

    return person;
  });
}

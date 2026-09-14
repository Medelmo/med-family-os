import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client";
import { people, householdMemberships } from "../../../db/schema";
import { authorizeHouseholdSettingsAccess } from "../../policies/household";
import type { Actor } from "../../policies/authorize";
import { AuthorizationError } from "../../errors";

export interface HouseholdMemberRow {
  personId: string;
  displayName: string;
  dateOfBirth: Date | null;
  role: string | null;
  hasAccount: boolean;
}

/**
 * Lists every active person in the household with their role, if they have
 * a login. docs/permissions.md's "People" row grants ADULT
 * "household-scoped" read, so this uses the household-settings policy
 * (read = allowed for ADULT/OWNER/ADMIN) rather than per-row
 * authorizePersonAccess, which would incorrectly deny a household roster
 * view to an ADULT looking at a CHILD's row.
 */
export async function getHouseholdMembers(actor: Actor, householdId: string): Promise<HouseholdMemberRow[]> {
  if (!authorizeHouseholdSettingsAccess(actor, "read", householdId)) {
    throw new AuthorizationError("Not permitted to view household members.");
  }

  const rows = await db
    .select({
      personId: people.id,
      displayName: people.displayName,
      dateOfBirth: people.dateOfBirth,
      accountUserId: people.accountUserId,
      role: householdMemberships.role,
    })
    .from(people)
    .leftJoin(
      householdMemberships,
      and(eq(householdMemberships.userId, people.accountUserId), eq(householdMemberships.status, "ACTIVE"))
    )
    .where(and(eq(people.householdId, householdId), isNull(people.archivedAt)));

  return rows.map((row) => ({
    personId: row.personId,
    displayName: row.displayName,
    dateOfBirth: row.dateOfBirth,
    role: row.role,
    hasAccount: row.accountUserId !== null,
  }));
}

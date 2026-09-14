import type { Role } from "../shared/types";

export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";

export interface HouseholdMembership {
  id: string;
  householdId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every household needs exactly one accountable OWNER at all times — the
 * app must never end up in a state where role changes/removals leave zero
 * owners with no path back in (a locked-out self-hosted household app has
 * no support desk to call). Callers changing or removing the OWNER role
 * must check this against the *other* active memberships before writing.
 */
export function wouldLeaveHouseholdWithoutOwner(
  activeMemberships: Pick<HouseholdMembership, "id" | "role" | "status">[],
  changingMembershipId: string,
  newRole: Role
): boolean {
  if (newRole === "OWNER") return false;
  const remainingOwners = activeMemberships.filter(
    (m) => m.id !== changingMembershipId && m.status === "ACTIVE" && m.role === "OWNER"
  );
  return remainingOwners.length === 0;
}

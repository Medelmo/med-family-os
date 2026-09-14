import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

// Feature-level policy wrappers composing the base canAccess() with rules
// docs/permissions.md states per resource type that the generic function
// cannot express on its own — see docs/audit/ARCHITECTURE_AUDIT.md §6.

export interface PersonResourceContext {
  householdId: string;
  personId: string;
  accountUserId: string | null;
  visibility: Visibility;
  sensitivity: Sensitivity;
}

/**
 * docs/permissions.md "People" row: Owner/Admin full, Adult household-
 * scoped, Child self/allowed, Viewer read.
 *
 * CHILD is handled as its own branch rather than always passing
 * `personScopeIds: [resource.personId]` to the base canAccess() — that
 * field is a *universal* restriction in canAccess (checked before any
 * role branch), so setting it unconditionally would also wrongly confine
 * ADULT/VIEWER to only the rows that happen to name their own personId,
 * instead of the household-scoped/read access docs/permissions.md actually
 * grants them. Caught by tests/unit/application/household-policy.spec.ts.
 */
export function authorizePersonAccess(actor: Actor, action: Action, resource: PersonResourceContext): boolean {
  const base = {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.accountUserId ?? undefined,
  };

  if (actor.role === "CHILD") {
    // "self/allowed": narrow to this specific person so canAccess's
    // explicit-scope requirement for CHILD only admits their own row.
    return canAccess(actor, action, { ...base, personScopeIds: [resource.personId] });
  }

  return canAccess(actor, action, base);
}

/**
 * docs/permissions.md "Household settings" row: Owner/Admin full, Adult
 * limited (read-only here), Child/Viewer none. This is stricter than the
 * base canAccess would produce on its own (which has no concept of
 * "household settings" as a resource type), so it does not delegate to
 * canAccess at all.
 */
export function authorizeHouseholdSettingsAccess(actor: Actor, action: Action, householdId: string): boolean {
  if (actor.householdId !== householdId) return false;
  if (actor.role === "OWNER" || actor.role === "ADMIN") return true;
  if (actor.role === "ADULT") return action === "read";
  return false;
}

/**
 * Creating a household member (person + optional login) is a household-
 * settings-shaped action even though its output is a Person row — the
 * decision "who gets added to this household" belongs to OWNER/ADMIN only,
 * matching addHouseholdMember's own docstring.
 */
export function authorizeAddHouseholdMember(actor: Actor, householdId: string): boolean {
  return authorizeHouseholdSettingsAccess(actor, "create", householdId);
}

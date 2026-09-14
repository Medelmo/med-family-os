import type { Role, Sensitivity, Visibility } from "../../domain/shared/types";

export interface Actor {
  userId: string;
  householdId: string;
  role: Role;
  personIds: string[];
}

export interface ResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  ownerUserId?: string;
  allowedUserIds?: string[];
  personScopeIds?: string[];
}

export type Action = "read" | "create" | "update" | "delete" | "archive";

export function canAccess(actor: Actor, action: Action, resource: ResourceContext): boolean {
  if (actor.householdId !== resource.householdId) return false;

  // OWNER/ADMIN have full access per docs/permissions.md; every other role
  // must clear the visibility/allow-list/person-scope gates below.
  if (actor.role === "OWNER" || actor.role === "ADMIN") return true;

  if (resource.visibility === "PRIVATE" && resource.ownerUserId !== actor.userId) return false;
  if (resource.allowedUserIds && !resource.allowedUserIds.includes(actor.userId)) return false;
  if (resource.personScopeIds?.length && !resource.personScopeIds.some(id => actor.personIds.includes(id))) return false;

  // VIEWER is read-only in every row of docs/permissions.md. There is no
  // action-based check elsewhere in this function, so this must be an
  // explicit early return rather than falling through to `return true`.
  if (actor.role === "VIEWER") return action === "read";

  if (actor.role === "CHILD") {
    if (resource.sensitivity !== "NORMAL") return false;
    // docs/permissions.md scopes every child row to "self/allowed/assigned/
    // participant/explicit" — an unscoped HOUSEHOLD resource is adult-shared
    // by default and must NOT be inherited by a child just because no
    // allow-list was set. Absence of scoping data means deny, not allow.
    const explicitlyScopedToChild =
      resource.ownerUserId === actor.userId ||
      (resource.allowedUserIds?.includes(actor.userId) ?? false) ||
      (resource.personScopeIds?.some(id => actor.personIds.includes(id)) ?? false);
    if (!explicitlyScopedToChild) return false;
    return action !== "delete";
  }

  // Remaining role is ADULT: household-scoped access per docs/permissions.md,
  // including delete (CHILD/VIEWER are excluded above).
  return true;
}

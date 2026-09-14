import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

/**
 * `docs/permissions.md` "Integrations" row: Owner/Admin full, Adult "none
 * by default", Child none, Viewer none.
 *
 * This does not delegate to `canAccess` at all, for the same reason
 * `authorizeHouseholdSettingsAccess` does not: the base function has no
 * concept of "integrations" as a resource, and an ADULT falls through its
 * role branches to `true`. Delegating would hand every adult in the
 * household the ability to point a connection at a new base URL and store
 * a credential under it — which is configuration of where the household's
 * data goes, not use of the household's data.
 *
 * Deliberately stricter than everything else in the app, and the strictest
 * row in the matrix apart from Audit.
 */
export function authorizeIntegrationAccess(actor: Actor, householdId: string): boolean {
  if (actor.householdId !== householdId) return false;
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

export interface DocumentResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  createdBy: string | null;
  personScopeIds: string[];
}

/**
 * Document references, which are a different matter from the integration
 * that produced them.
 *
 * `docs/permissions.md` "Documents" row: Owner/Admin full, Adult
 * "sensitivity-scoped", Child "explicit only", Viewer "read allowed" —
 * which is exactly what the kernel already does, so this adds nothing on
 * top. References default to `SENSITIVE` (a household's paperwork is
 * administrative and medical), and that default is what keeps them away
 * from child accounts without a rule of its own.
 */
export function authorizeDocumentAccess(actor: Actor, action: Action, resource: DocumentResourceContext): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.createdBy ?? undefined,
    personScopeIds: resource.personScopeIds.length > 0 ? resource.personScopeIds : undefined,
  });
}

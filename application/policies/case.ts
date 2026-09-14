import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

export interface CaseResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  createdBy: string | null;
  /** People the case is about (db/schema/case.ts casePeople). */
  personScopeIds: string[];
}

/**
 * docs/permissions.md "Cases" row: Owner/Admin full, Adult "allowed
 * scope", Child "explicitly assigned only", Viewer "read allowed".
 *
 * As with tasks, `personScopeIds` is only passed through when the case
 * actually names people — it narrows every role, which is right for a case
 * about one child and wrong as a blanket default.
 */
export function authorizeCaseAccess(actor: Actor, action: Action, resource: CaseResourceContext): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.createdBy ?? undefined,
    personScopeIds: resource.personScopeIds.length > 0 ? resource.personScopeIds : undefined,
  });
}

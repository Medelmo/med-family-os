import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

export interface AssetResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  createdBy: string | null;
  /** Whose asset it is, when it belongs to a person rather than the household. */
  personScopeIds: string[];
}

/**
 * Assets, warranties and maintenance records.
 *
 * Nothing role-specific on top of the kernel, deliberately: `canAccess`
 * already refuses a CHILD anything above NORMAL sensitivity and confines a
 * VIEWER to reads. What makes assets interesting is that their sensitivity
 * is not uniform — a dishwasher is NORMAL, a wheelchair is SENSITIVE — and
 * that decision is made once, from the category, in
 * `defaultSensitivityFor`. Re-deciding it here would create a second place
 * for it to drift.
 *
 * A warranty and a service record inherit the asset's context rather than
 * carrying their own. They have no meaning apart from the thing they are
 * about, and giving them independent visibility would let a service record
 * be readable when the machine it describes is not.
 */
export function authorizeAssetAccess(actor: Actor, action: Action, resource: AssetResourceContext): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.createdBy ?? undefined,
    personScopeIds: resource.personScopeIds.length > 0 ? resource.personScopeIds : undefined,
  });
}

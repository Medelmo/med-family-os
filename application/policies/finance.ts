import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

export interface FinanceResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  createdBy: string | null;
  /** The person an expense or claim is about, when it names one. */
  personScopeIds: string[];
}

/**
 * Expenses and reimbursements, which default to SENSITIVE (ADR-015 §4).
 *
 * Nothing role-specific is added on top of the kernel, and that is the
 * point: `canAccess` already refuses a CHILD anything above NORMAL
 * sensitivity, and confines a VIEWER to reads. Re-deciding those rules here
 * would create a second place they could drift.
 *
 * `personScopeIds` is passed through only when the record actually names a
 * person, exactly as the task and case policies do — it narrows every
 * role, which is right for an expense about one child and wrong as a
 * blanket default.
 */
export function authorizeExpenseAccess(actor: Actor, action: Action, resource: FinanceResourceContext): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.createdBy ?? undefined,
    personScopeIds: resource.personScopeIds.length > 0 ? resource.personScopeIds : undefined,
  });
}

export const authorizeReimbursementAccess = authorizeExpenseAccess;

/**
 * Budgets are household planning, not a record about anyone, so they carry
 * no person scope. They are still SENSITIVE: "the household budgets 600 a
 * month for health" is exactly the kind of financial detail CLAUDE.md §10
 * keeps away from child accounts and from Home Assistant.
 */
export function authorizeBudgetAccess(
  actor: Actor,
  action: Action,
  resource: { householdId: string }
): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "SENSITIVE",
  });
}

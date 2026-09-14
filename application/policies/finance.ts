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
 * `canAccess` does most of the work — it already refuses a CHILD anything
 * above NORMAL sensitivity and confines a VIEWER to reads — but one rule
 * has to be added here, because the kernel has no concept of "finance".
 *
 * **A VIEWER gets nothing.** `docs/permissions.md` has always said
 * "Finance | Viewer | none by default", and the kernel by itself gave a
 * viewer read access to every expense and claim in the household: it
 * applies a sensitivity ceiling to CHILD only, and a VIEWER passes
 * straight through on any read. A viewer is the carer, the relative, the
 * account somebody is given so they can *see the calendar* — and they were
 * getting the household's complete financial history.
 *
 * The gap went unnoticed because no screen made it obvious: a viewer had
 * to go and look at the finance page. Building the export is what surfaced
 * it, and that is the pattern worth noting — an export turns a per-record
 * over-grant into one file containing all of it, so it is where a quiet
 * policy gap stops being quiet.
 *
 * "By default" is doing no work yet, because a finance record has no
 * allow-list to make an exception with: `FinanceResourceContext` carries
 * no `allowedUserIds`, so a flat refusal is exactly as granular as the
 * data allows. If one is ever added — "this carer may see the care
 * expenses" is a plausible thing a household would want — this check is
 * where it belongs, and it should consult the list rather than being
 * softened for every viewer.
 *
 * `personScopeIds` is passed through only when the record actually names a
 * person, exactly as the task and case policies do — it narrows every
 * role, which is right for an expense about one child and wrong as a
 * blanket default.
 */
export function authorizeExpenseAccess(actor: Actor, action: Action, resource: FinanceResourceContext): boolean {
  if (actor.role === "VIEWER") return false;

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
  // Finance is "none by default" for a VIEWER, and a budget is finance —
  // see authorizeExpenseAccess for why the kernel does not cover this.
  if (actor.role === "VIEWER") return false;

  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: "HOUSEHOLD",
    sensitivity: "SENSITIVE",
  });
}

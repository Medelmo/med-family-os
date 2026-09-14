import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

export interface TaskResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  /** The account that created it — "owner" in the authorization sense. */
  createdBy: string | null;
  /** People the task is *about* (db/schema/task.ts taskPeople). */
  personScopeIds: string[];
}

/**
 * docs/permissions.md "Tasks" row: Owner/Admin full, Adult
 * create/read/update allowed, Child assigned/self only, Viewer read.
 *
 * Only passes `personScopeIds` through when the task actually names
 * people. That field is a universal restriction in the base canAccess
 * (checked before any role branch), so passing an empty array would be
 * harmless but passing a populated one narrows *every* role — which is
 * correct here and intentional: a task explicitly scoped to one child
 * should not be general household reading material. The same field being
 * wrong for Person rows is what
 * tests/unit/application/household-policy.spec.ts caught earlier, so the
 * distinction is deliberate rather than copied.
 */
export function authorizeTaskAccess(actor: Actor, action: Action, resource: TaskResourceContext): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.createdBy ?? undefined,
    personScopeIds: resource.personScopeIds.length > 0 ? resource.personScopeIds : undefined,
  });
}

/**
 * Capturing to the Inbox is deliberately the least restricted write in the
 * system: CLAUDE.md §4.1 wants triage to be fast, and a capture box that
 * refuses input is a capture box nobody uses. Any household member who is
 * not a read-only VIEWER may capture.
 */
export function authorizeInboxCapture(actor: Actor, householdId: string): boolean {
  if (actor.householdId !== householdId) return false;
  return actor.role !== "VIEWER";
}

/**
 * Triage is a different question from capture: it decides what a thing
 * *is* and creates a durable record from it, so it follows the ordinary
 * Tasks-row permissions rather than the permissive capture rule.
 */
export function authorizeInboxTriage(actor: Actor, householdId: string): boolean {
  if (actor.householdId !== householdId) return false;
  return actor.role === "OWNER" || actor.role === "ADMIN" || actor.role === "ADULT";
}

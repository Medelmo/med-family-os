import { canAccess, type Action, type Actor } from "./authorize";
import type { Sensitivity, Visibility } from "../../domain/shared/types";

export interface TripResourceContext {
  householdId: string;
  visibility: Visibility;
  sensitivity: Sensitivity;
  createdBy: string | null;
  /** Who is going — feeds personScopeIds authorization. */
  personScopeIds: string[];
}

/**
 * Trips, and everything hanging off one.
 *
 * Trips default to NORMAL sensitivity rather than SENSITIVE, unlike
 * expenses: a family holiday is ordinary household business, and a child
 * who is going on the trip has every reason to see the itinerary and their
 * own packing list. That is the whole point of a shared family view.
 *
 * `docs/permissions.md` grants a CHILD a "participant-safe view", and the
 * participant list is exactly what delivers it: the policy kernel gives a
 * CHILD only what is explicitly scoped to them, so a child sees a trip
 * **because they are named as going on it**, not because it exists.
 *
 * The consequence is worth stating plainly, because it surprised this
 * implementation's own first test: a trip with no participants at all is
 * invisible to every child in the household. That is the correct reading
 * of CLAUDE.md §5 ("Children ... never inherit adult access") rather than
 * a gap — a trip nobody has been added to is a trip nobody has been told
 * they are going on. Adults and viewers see it either way.
 *
 * An access requirement about one person is the case worth being careful
 * about — "Lukas needs a step-free bathroom" is health-adjacent — so an
 * item carrying a `personId` is scoped to that person rather than to the
 * trip's whole party.
 */
export function authorizeTripAccess(actor: Actor, action: Action, resource: TripResourceContext): boolean {
  return canAccess(actor, action, {
    householdId: resource.householdId,
    visibility: resource.visibility,
    sensitivity: resource.sensitivity,
    ownerUserId: resource.createdBy ?? undefined,
    personScopeIds: resource.personScopeIds.length > 0 ? resource.personScopeIds : undefined,
  });
}

/**
 * The people an item on a trip is "about".
 *
 * An item naming a person is scoped to that person — "Lukas's inhaler" or
 * "Ada needs a ground-floor room" is narrower than the trip itself. An
 * item naming nobody belongs to the trip, so it inherits the trip's
 * participants.
 *
 * Getting this wrong is not a small matter and the first draft did: with
 * an unscoped item treated as scoped to nobody, the policy kernel refused
 * a CHILD every line on a trip they were going on, because a CHILD only
 * ever sees what is explicitly scoped to them. The child could see that
 * the trip existed and nothing that was on it — which is precisely the
 * "participant-safe view" docs/permissions.md promises, inverted.
 */
export function tripItemScope(item: { personId: string | null }, tripParticipantIds: readonly string[]): string[] {
  return item.personId ? [item.personId] : [...tripParticipantIds];
}

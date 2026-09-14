import { redirect } from "next/navigation";
import { auth } from "./auth";
import type { Actor } from "../../application/policies/authorize";

export interface CurrentActor {
  actor: Actor;
  householdId: string;
  userName: string;
}

/**
 * Maps the Auth.js session onto the `Actor` the application policies take.
 *
 * Lives in infrastructure because it adapts a specific auth library to a
 * domain-shaped input — application code takes an `Actor` and never knows
 * Auth.js exists (docs/architecture/module-boundaries.md).
 *
 * Redirects rather than returning null: every caller is a page under
 * app/(app)/, where "no session" and "no household" both mean the same
 * thing — this person cannot be here yet.
 */
export async function requireActor(): Promise<CurrentActor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * The same mapping without the redirect, for callers that are not pages.
 *
 * A route handler answering a fetch must not reply with a 307 to an HTML
 * sign-in page: the caller asked for a file and would receive a login
 * form, which is a confusing success rather than an honest refusal. Route
 * handlers use this and return a status themselves.
 */
export async function currentActor(): Promise<CurrentActor | null> {
  const session = await auth();

  if (!session?.user?.id) return null;
  if (!session.user.householdId || !session.user.role) return null;

  return {
    actor: {
      userId: session.user.id,
      householdId: session.user.householdId,
      role: session.user.role,
      personIds: session.user.personIds,
    },
    householdId: session.user.householdId,
    userName: session.user.name ?? session.user.email ?? "",
  };
}

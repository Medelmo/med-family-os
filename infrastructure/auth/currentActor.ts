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
  const session = await auth();

  if (!session?.user?.id) redirect("/login");
  if (!session.user.householdId || !session.user.role) redirect("/login");

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

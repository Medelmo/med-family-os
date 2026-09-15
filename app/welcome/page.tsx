import { requireActor } from "../../infrastructure/auth/currentActor";
import { getAttention } from "../../application/queries/attention/getAttention";
import { WelcomeClient } from "./WelcomeClient";

/**
 * Screen 50 — the welcome moment (ADR-026).
 *
 * Outside the `(app)` route group on purpose: it has no shell, no
 * navigation and no chrome of any kind. It is one sentence on the ground
 * the rest of the application floats on.
 *
 * Reached only by signing in, which is also what makes the voice work —
 * submitting the login form is the user gesture browsers require before a
 * page is allowed to make a sound.
 *
 * The greeting uses the person's own name from their session, never a
 * value from the URL: a welcome screen that greeted whoever a query
 * parameter said would be a small, silly way to make the application say
 * something untrue about who is signed in.
 */
export default async function WelcomePage() {
  const { actor, householdId, userName } = await requireActor();

  // The same authorized query the Attention page uses, so the count is
  // what this person can actually see — not the household's total.
  const { items } = await getAttention(actor, householdId);

  // First name only. "Willkommen Mohamed" is a greeting; "Willkommen
  // Mohamed Elmouddene" is a summons.
  const firstName = userName.trim().split(/\s+/)[0] || userName;

  return <WelcomeClient name={firstName} attentionCount={items.length} next="/today" />;
}

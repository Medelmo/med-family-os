"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "../../infrastructure/auth/auth";
import { eq } from "drizzle-orm";
import { db } from "../../infrastructure/db/client";
import { sessionRevocations } from "../../db/schema";

export async function signOutAction(): Promise<void> {
  const session = await auth();

  // Explicitly revoke the underlying session_revocation row (ADR-006), not
  // just clear the cookie — signOut() alone removes the client's cookie but
  // the JWT strategy has no server-side session to delete the way a
  // database-session strategy would; the revocation table is what makes
  // "this token is no longer valid" durable server-side. Only THIS
  // session's row (session.sid) is revoked — a plain sign-out must not log
  // out the user's other devices; that is a separate, explicit
  // "sign out everywhere" action (Phase 2+, screen inventory item 9).
  if (session?.sid) {
    await db.update(sessionRevocations).set({ revokedAt: new Date() }).where(eq(sessionRevocations.id, session.sid));
  }

  await signOut({ redirect: false });
  redirect("/login");
}

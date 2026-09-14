import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "../../infrastructure/auth/auth";
import { AppShell } from "../../components/app-shell/AppShell";
import { getUnreadNotificationCount } from "../../application/queries/notifications/getNotifications";

// This is the authoritative auth check (see infrastructure/auth/auth.config.ts
// for why middleware's own check is only an optimistic pre-filter): every
// route under app/(app)/ renders through this layout, so every one of them
// gets the full, DB-backed, revocation-checked auth() before rendering
// anything.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const unreadNotifications =
    session.user.householdId && session.user.role
      ? await getUnreadNotificationCount({
          userId: session.user.id,
          householdId: session.user.householdId,
          role: session.user.role,
          personIds: session.user.personIds,
        })
      : 0;

  return (
    <AppShell userName={session.user.name ?? session.user.email ?? ""} unreadNotifications={unreadNotifications}>
      {children}
    </AppShell>
  );
}

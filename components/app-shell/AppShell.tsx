import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "../../app/(app)/actions";
import { Button } from "../ui/Button";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  userName: string;
  unreadNotifications: number;
  children: ReactNode;
}

export async function AppShell({ userName, unreadNotifications, children }: AppShellProps) {
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <span className={styles.appName}>{tCommon("appName")}</span>
        {/* Ordered by the question each answers, not alphabetically:
            what's on today, what came in, what's flagged, then the
            reference views. */}
        <nav className={styles.nav} aria-label={tCommon("appName")}>
          <Link href="/today" className={styles.navLink}>
            {tNav("today")}
          </Link>
          <Link href="/inbox" className={styles.navLink}>
            {tNav("inbox")}
          </Link>
          <Link href="/attention" className={styles.navLink}>
            {tNav("attention")}
          </Link>
          <Link href="/tasks" className={styles.navLink}>
            {tNav("tasks")}
          </Link>
          <Link href="/cases" className={styles.navLink}>
            {tNav("cases")}
          </Link>
          <Link href="/calendar" className={styles.navLink}>
            {tNav("calendar")}
          </Link>
          <Link href="/family" className={styles.navLink}>
            {tNav("family")}
          </Link>
          <Link href="/notifications" className={styles.navLink}>
            {tNav("notifications")}
            {unreadNotifications > 0 && (
              // The count is inside the link's accessible name rather than
              // a bare coloured dot, so a screen reader hears "Notifications,
              // 2 unread" instead of just "Notifications".
              <span className={styles.badge} aria-label={tNav("unreadCount", { count: unreadNotifications })}>
                {unreadNotifications}
              </span>
            )}
          </Link>
        </nav>
        <div className={styles.userArea}>
          <span className={styles.userName}>{userName}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="secondary">
              {tNav("signOut")}
            </Button>
          </form>
        </div>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}

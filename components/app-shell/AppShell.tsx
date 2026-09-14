import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "../../app/(app)/actions";
import { BottomNav, SidebarNav } from "./Nav";
import { Button } from "../ui/Button";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  userName: string;
  unreadNotifications: number;
  children: ReactNode;
}

/**
 * The shell from docs/design/implementation-handoff.md: a sidebar on the
 * desktop, a bottom bar on a phone.
 *
 * The earlier single wrapping top bar was fine at two destinations and
 * wrong at eight — it overflowed a phone horizontally (a real bug, now
 * guarded by a test) and then ate several rows of vertical space once
 * wrapped. Which layout applies is decided in CSS by a media query rather
 * than by sniffing the user agent on the server, so it stays correct when
 * a window is simply resized.
 */
export async function AppShell({ userName, unreadNotifications, children }: AppShellProps) {
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <span className={styles.appName}>{tCommon("appName")}</span>
        <div className={styles.userArea}>
          <span className={styles.userName}>{userName}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="secondary">
              {tNav("signOut")}
            </Button>
          </form>
        </div>
      </header>

      <div className={styles.body}>
        <SidebarNav unreadNotifications={unreadNotifications} />
        <main className={styles.content}>{children}</main>
      </div>

      <BottomNav unreadNotifications={unreadNotifications} />
    </div>
  );
}

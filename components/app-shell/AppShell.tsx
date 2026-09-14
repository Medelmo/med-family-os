import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "../../app/(app)/actions";
import { Button } from "../ui/Button";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  userName: string;
  children: ReactNode;
}

export async function AppShell({ userName, children }: AppShellProps) {
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <span className={styles.appName}>{tCommon("appName")}</span>
        <nav className={styles.nav} aria-label={tNav("today")}>
          <a href="/dashboard" className={styles.navLink}>
            {tNav("today")}
          </a>
          <a href="/family" className={styles.navLink}>
            {tNav("family")}
          </a>
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

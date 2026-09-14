"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { NAV_ITEMS, PRIMARY_NAV_ITEMS } from "./navItems";
import styles from "./AppShell.module.css";

function useIsCurrent() {
  const pathname = usePathname();
  // A section counts as current for its own detail pages too, so opening
  // a case still shows Cases as where you are.
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ unreadNotifications }: { unreadNotifications: number }) {
  const t = useTranslations("nav");
  const isCurrent = useIsCurrent();

  return (
    <nav className={styles.sidebarNav} aria-label={t("primary")}>
      <ul className={styles.sidebarList}>
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={styles.sidebarLink}
              // aria-current is what tells a screen-reader user where they
              // are; the visual highlight alone would be colour-only
              // meaning, which CLAUDE.md §13 forbids.
              aria-current={isCurrent(item.href) ? "page" : undefined}
            >
              {t(item.labelKey)}
              {item.href === "/notifications" && unreadNotifications > 0 && (
                <span className={styles.badge} aria-label={t("unreadCount", { count: unreadNotifications })}>
                  {unreadNotifications}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BottomNav({ unreadNotifications }: { unreadNotifications: number }) {
  const t = useTranslations("nav");
  const isCurrent = useIsCurrent();

  return (
    <nav className={styles.bottomNav} aria-label={t("primary")}>
      <ul className={styles.bottomList}>
        {PRIMARY_NAV_ITEMS.map((item) => (
          <li key={item.href} className={styles.bottomItem}>
            <Link
              href={item.href}
              className={styles.bottomLink}
              aria-current={isCurrent(item.href) ? "page" : undefined}
            >
              {t(item.shortLabelKey ?? item.labelKey)}
              {item.href === "/notifications" && unreadNotifications > 0 && (
                <span className={styles.badge} aria-label={t("unreadCount", { count: unreadNotifications })}>
                  {unreadNotifications}
                </span>
              )}
            </Link>
          </li>
        ))}
        <li className={styles.bottomItem}>
          {/* A page rather than a sheet: it needs no JavaScript, is
              linkable, and scales as later phases add destinations. */}
          <Link href="/more" className={styles.bottomLink} aria-current={isCurrent("/more") ? "page" : undefined}>
            {t("more")}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

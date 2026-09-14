import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireActor } from "../../../infrastructure/auth/currentActor";
import { SECONDARY_NAV_ITEMS } from "../../../components/app-shell/navItems";
import { Card } from "../../../components/ui/Card";
import styles from "./more.module.css";

/**
 * The destinations that do not fit the phone's bottom bar.
 *
 * A page rather than a slide-up sheet: it needs no JavaScript, it can be
 * linked and bookmarked, and it is trivially accessible. On the desktop
 * the sidebar already lists everything, so this is reachable but
 * redundant there — which is fine, and cheaper than conditionally hiding
 * a route.
 */
export default async function MorePage() {
  await requireActor();
  const t = await getTranslations("nav");
  const tMore = await getTranslations("more");

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{tMore("title")}</h1>
      <Card>
        <ul className={styles.list}>
          {SECONDARY_NAV_ITEMS.map((item) => (
            <li key={item.href} className={styles.row}>
              <Link href={item.href} className={styles.link}>
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

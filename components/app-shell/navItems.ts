/**
 * The primary navigation, in one place so the sidebar, the mobile bottom
 * bar and the "More" page cannot drift apart.
 *
 * `primary` marks the destinations that earn a slot in the mobile bottom
 * bar. The split is not arbitrary: docs/requirements/product-spec.md says
 * the app exists to answer "what needs my attention?", so the four that
 * answer it directly get one tap, and the reference views — the places you
 * go when you already know what you are looking for — live behind More.
 *
 * Everything a later phase adds should default to secondary; the bottom
 * bar does not grow.
 */
export interface NavItem {
  href: string;
  /** Key under the `nav` message namespace. */
  labelKey: string;
  /**
   * Optional shorter label for the bottom bar. Five slots across a 375px
   * phone leave roughly 75px each: "Notifications" and its German
   * "Mitteilungen" both wrap and then clip against the 64px bar. A
   * deliberate short word beats hoping a long one wraps gracefully.
   *
   * The visible text is also the accessible name in both cases, so
   * WCAG 2.5.3 (Label in Name) holds either way.
   */
  shortLabelKey?: string;
  primary: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/today", labelKey: "today", primary: true },
  { href: "/inbox", labelKey: "inbox", primary: true },
  { href: "/attention", labelKey: "attention", primary: true },
  { href: "/notifications", labelKey: "notifications", shortLabelKey: "notificationsShort", primary: true },
  { href: "/tasks", labelKey: "tasks", primary: false },
  { href: "/cases", labelKey: "cases", primary: false },
  { href: "/calendar", labelKey: "calendar", primary: false },
  { href: "/family", labelKey: "family", primary: false },
];

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.primary);
export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.primary);

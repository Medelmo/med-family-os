import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { SIGNED_OUT_STATE } from "./helpers";

// CLAUDE.md §13 / docs/qa/acceptance.md: WCAG 2.2 AA is the target, and
// accessibility is not a final polish step. Automated checks catch only a
// subset (contrast, names, roles, landmarks) — they do not replace the
// manual keyboard/screen-reader review the acceptance doc also requires,
// which is why the keyboard journey below is asserted explicitly.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
}

/**
 * Presses Tab until the target holds focus. The bound is generous because
 * how many stops precede the navigation depends on how much content the
 * page happens to be showing; the assertion afterwards, not the bound, is
 * what proves the target was reachable.
 */
async function tabUntilFocused(page: Page, target: Locator, maxPresses = 40) {
  await expect(target).toBeVisible();
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT_STATE });

  test("sign-in page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("signed in", () => {
  test("today has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expectNoViolations(page);
  });

  test("notifications page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("calendar page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("family page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/family");
    await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("finance page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/finance");
    await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("claims page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/finance/claims");
    await expect(page.getByRole("heading", { name: "Reimbursement claims" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("more page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/more");
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
    await expectNoViolations(page);
  });

  // docs/design/implementation-handoff.md: "Never horizontally scroll
  // primary content." This caught a real regression: the nav was a
  // non-wrapping flex row, so each new destination pushed the page wider
  // until, at eight, a phone viewport overflowed and taps began landing on
  // the wrong element.
  for (const path of ["/today", "/calendar", "/cases", "/inbox", "/notifications", "/more", "/finance"]) {
    test(`${path} does not scroll horizontally`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // A pixel of tolerance for sub-pixel rounding.
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }

  // Inbox is one of the four destinations that earn a slot in both
  // layouts (components/app-shell/navItems.ts), so this asserts the same
  // guarantee on the desktop sidebar and the phone bottom bar.
  test("primary navigation is reachable and operable by keyboard alone", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

    // Keyboard only — no clicks (docs/qa/acceptance.md "keyboard-only
    // critical flows").
    const navInbox = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Inbox" });
    await tabUntilFocused(page, navInbox);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  // The phone bottom bar deliberately does not carry every destination, so
  // the secondary ones have to stay reachable through More — otherwise the
  // layout that saved horizontal space would have stranded half the app on
  // a phone.
  test("secondary destinations are reachable by keyboard through More", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "More only appears in the phone layout");

    await page.goto("/today");

    // Five slots, fixed. Later phases add destinations behind More; the
    // bar itself does not grow, which is what keeps it off the horizontal
    // overflow the test above guards.
    const nav = page.getByRole("navigation", { name: "Primary" });
    const hrefs = await nav.getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hrefs).toEqual(["/today", "/inbox", "/attention", "/notifications", "/more"]);

    await tabUntilFocused(page, nav.getByRole("link", { name: "More" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();

    await tabUntilFocused(page, page.getByRole("link", { name: "Family" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();
  });

  test("the desktop sidebar carries every destination", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "sidebar only appears at the desktop breakpoint");

    await page.goto("/today");
    const nav = page.getByRole("navigation", { name: "Primary" });
    // Compared by href rather than by label: the notifications link grows
    // an unread badge, and this assertion is about which destinations are
    // present, not about how they are worded.
    const hrefs = await nav.getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hrefs).toEqual([
      "/today",
      "/inbox",
      "/attention",
      "/notifications",
      "/tasks",
      "/cases",
      "/calendar",
      "/finance",
      "/family",
    ]);
    // Colour alone must not communicate where you are (CLAUDE.md §13).
    await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });
});

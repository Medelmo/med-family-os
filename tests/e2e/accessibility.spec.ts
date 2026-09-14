import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
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

  test("family page has no automatically detectable WCAG violations", async ({ page }) => {
    await page.goto("/family");
    await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("primary navigation is reachable and operable by keyboard alone", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();

    // Tab until the Family link takes focus, then activate it with the
    // keyboard only — no clicks (docs/qa/acceptance.md "keyboard-only
    // critical flows").
    const familyLink = page.getByRole("link", { name: "Family" });
    for (let i = 0; i < 10; i++) {
      if (await familyLink.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(familyLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();
  });
});

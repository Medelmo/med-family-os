import { expect, test, type Page } from "@playwright/test";
import { OWNER } from "./helpers";

/**
 * The welcome moment and the language it speaks (ADR-026, ADR-008).
 *
 * The voice itself cannot be asserted here — a CI runner has no speech
 * engine and no speakers, and a test that required one would fail for a
 * reason that has nothing to do with this application. What *is* asserted
 * is everything around it: that the greeting says the right person's name
 * in the right language, that the moment ends by itself, that it can be
 * left early, and that a device with no voice still shows the words rather
 * than failing silently.
 */

async function setLanguage(page: Page, value: "en" | "de", saveLabel: string) {
  await page.goto("/settings/language");
  await page.getByLabel(/Language|Sprache/).selectOption(value);
  await page.getByRole("button", { name: saveLabel }).click();
  await expect(page.getByRole("status")).toBeVisible();
}

test.describe("the welcome moment", () => {
  test.afterEach(async ({ page }) => {
    // The locale is a cookie, so a test that changes it would change every
    // test after it. Put back.
    await page.goto("/settings/language");
    const select = page.getByLabel(/Language|Sprache/);
    if ((await select.inputValue()) !== "en") {
      await select.selectOption("en");
      await page.getByRole("button", { name: /Save language|Sprache speichern/ }).click();
      await expect(page.getByRole("status")).toBeVisible();
    }
  });

  test("greets the signed-in person by their first name", async ({ page }) => {
    await page.goto("/welcome");

    // First name only: a greeting, not a summons.
    const first = OWNER.name.split(" ")[0];
    await expect(page.getByRole("status")).toContainText(`Welcome ${first}`);
    await expect(page.getByRole("status")).not.toContainText(OWNER.name);

    // The android is present and described, not left as decoration.
    await expect(page.getByRole("img", { name: /assistant/i })).toBeVisible();
  });

  test("says Willkommen in German", async ({ page }) => {
    await setLanguage(page, "de", "Save language");

    await page.goto("/welcome");
    await expect(page.getByRole("status")).toContainText(`Willkommen ${OWNER.name.split(" ")[0]}`);
    await expect(page.getByRole("button", { name: "Weiter" })).toBeVisible();
  });

  test("continues to Today on its own", async ({ page }) => {
    await page.goto("/welcome");
    // No click: the moment ends by itself.
    await expect(page).toHaveURL(/\/today$/, { timeout: 15000 });
  });

  test("can be left immediately", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("can be left with the keyboard", async ({ page }) => {
    await page.goto("/welcome");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/today$/);
  });

  // A runner has no speech engine, so this is the path every CI run takes —
  // which makes it the one most worth asserting: the words must still be
  // there, and the screen must still move on.
  test("shows the greeting even where there is no voice to speak it", async ({ page }) => {
    await page.goto("/welcome");

    const greeting = page.getByRole("status");
    await expect(greeting).toContainText("Welcome");
    // Whatever the voice does, the summary is present and the moment ends.
    await expect(greeting).toContainText(/attention|Nothing/i);
    await expect(page).toHaveURL(/\/today$/, { timeout: 15000 });
  });

  /*
   * "Signing in lands here" is asserted in auth.setup.ts instead.
   *
   * Not an omission — a deliberate one. Sign-in is rate limited to five
   * attempts per fifteen minutes per email (ADR-009), and auth.setup.ts
   * already says in its own docstring that a suite authenticating per test
   * tripped that limiter. A second real sign-in on the shared owner account
   * is exactly that mistake, and it fails in a way that looks like a broken
   * redirect rather than a spent budget. The setup project performs one
   * genuine sign-in; the assertion belongs there.
   */
});

/**
 * The assistant on the home screen.
 *
 * The expression itself is not asserted — which state the face wears is a
 * CSS custom property on a div, and pinning it here would make every
 * tuning change a test change. What is asserted is the part a household
 * depends on: the face is announced rather than left as decoration, it is
 * announced exactly once, and it does not push the day's actual list off
 * the screen.
 */
test.describe("the assistant on Today", () => {
  test("is present and described", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("img", { name: /assistant/i })).toBeVisible();
  });

  test("does not displace the day's own heading", async ({ page }) => {
    await page.goto("/today");

    const heading = page.getByRole("heading", { name: "Today", level: 1 });
    await expect(heading).toBeVisible();

    // The brief asks for the face to be prominent without overwhelming the
    // task and deadline information. Concretely: the heading is still above
    // the fold on a phone, with the face below it rather than in front.
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(page.viewportSize()!.height / 2);
  });

  test("keeps the artwork out of the accessibility tree twice over", async ({ page }) => {
    await page.goto("/today");

    // The wrapper carries the name; the <img> inside it must not repeat it.
    // A face announced twice is worse than one announced once.
    const named = page.getByRole("img", { name: /assistant/i });
    await expect(named).toHaveCount(1);
  });
});

test.describe("language", () => {
  test("switching to German changes the whole interface", async ({ page }) => {
    await setLanguage(page, "de", "Save language");

    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();

    // And back, so the rest of the suite is unaffected.
    await page.goto("/settings/language");
    await page.getByLabel("Sprache").selectOption("en");
    await page.getByRole("button", { name: "Sprache speichern" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  });

  test("is reachable by everyone from Settings", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "Language" }).click();
    await expect(page.getByRole("heading", { name: "Language", level: 1 })).toBeVisible();
  });
});

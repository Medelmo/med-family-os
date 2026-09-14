import { expect, test as setup } from "@playwright/test";
import { OWNER, OWNER_STORAGE_STATE, SECOND_MEMBER } from "./helpers";

/**
 * Runs once before the browser projects (Playwright "setup project"), and
 * does double duty:
 *
 * 1. It *is* the first-run bootstrap journey test — the real UI path
 *    through ADR-012's one-time setup, which by definition can only be
 *    exercised once per database.
 * 2. It saves the resulting session as storage state, so the other specs
 *    reuse one authenticated session instead of signing in again per test.
 *
 * That reuse is not just a speed optimisation: sign-in is rate limited to
 * 5 attempts per 15 minutes per email (ADR-009), and a suite that
 * authenticated per test tripped its own limiter and failed. Sharing the
 * session keeps the security control at its real production setting
 * instead of loosening it for the tests' convenience.
 */
setup("bootstrap the household and save the owner session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);

  await page.getByLabel("Household name").fill(OWNER.householdName);
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create household" }).click();

  // Bootstrap signs the new owner straight in rather than bouncing them
  // to /login with the credentials they just typed.
  await expect(page.getByText(`Hello, ${OWNER.name}`)).toBeVisible();

  // A second account for the sign-out spec (see helpers.ts).
  await page.goto("/family");
  await page.getByLabel("Name", { exact: true }).fill(SECOND_MEMBER.name);
  await page.getByLabel("Role").selectOption("ADULT");
  await page.getByLabel(/^Email/).fill(SECOND_MEMBER.email);
  await page.getByLabel("Temporary password").fill(SECOND_MEMBER.password);
  await page.getByRole("button", { name: "Add household member" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: SECOND_MEMBER.name })).toBeVisible();

  await page.context().storageState({ path: OWNER_STORAGE_STATE });
});

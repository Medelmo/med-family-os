import { expect, test } from "@playwright/test";
import { OWNER, SECOND_MEMBER, SIGNED_OUT_STATE } from "./helpers";

// CLAUDE.md §25 / docs/qa/acceptance.md: critical journeys for the Phase 1
// vertical slice (authentication -> household -> person -> policy).
// The first-run bootstrap journey itself lives in auth.setup.ts, which can
// only run once per database (ADR-012).
//
// Specs here reuse the owner session saved by that setup project, except
// where a spec is specifically about an auth transition.

test.describe("as a signed-in owner", () => {
  test("sees Today after signing in", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText(`Hello, ${OWNER.name}`)).toBeVisible();
  });

  test("cannot reach setup again once the household exists (ADR-012)", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).not.toHaveURL(/\/setup/);
  });

  test("adds a household member without a login and sees it listed", async ({ page }) => {
    const memberName = `Kid ${Date.now()}`;
    await page.goto("/family");
    await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill(memberName);
    await page.getByLabel("Role").selectOption("CHILD");
    await page.getByRole("button", { name: "Add household member" }).click();

    const row = page.getByRole("listitem").filter({ hasText: memberName });
    await expect(row).toBeVisible();
    await expect(row.getByText("No login")).toBeVisible();
  });
});

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT_STATE });

  test("cannot reach a protected route", async ({ page }) => {
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("a wrong password is rejected without revealing whether the account exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill("definitely not the password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Scoped by text as well as role: Next.js ships its own
    // `<div role="alert">` route announcer, so a bare getByRole("alert")
    // matches two elements once the page is hydrated.
    // docs/security/threat-model.md: the message must not distinguish
    // "no such account" from "wrong password".
    const error = page.getByRole("alert").filter({ hasText: "Incorrect email or password." });
    await expect(error).toBeVisible();
  });

  test("signing out revokes the session and protects the app again", async ({ page }) => {
    // Uses the secondary account, not the shared owner session: sign-out
    // revokes the session row server-side (ADR-006), which would
    // invalidate the storage state every other spec depends on.
    await page.goto("/login");
    await page.getByLabel("Email").fill(SECOND_MEMBER.email);
    await page.getByLabel("Password").fill(SECOND_MEMBER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(`Hello, ${SECOND_MEMBER.name}`)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/today");
    await expect(page).toHaveURL(/\/login/);
  });
});

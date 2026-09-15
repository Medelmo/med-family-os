import { expect, test, type Page } from "@playwright/test";

/**
 * The assistant, from the household's side (ADR-027).
 *
 * CI has no model and the E2E environment configures none, so what this
 * asserts is the half that matters most and is hardest to get right: that
 * an application with no assistant configured shows **nothing at all**.
 *
 * CLAUDE.md §11 says "AI is optional and cannot be required for core
 * operation", and the difference between implementing that and claiming it
 * is whether the surfaces disappear or merely refuse. A disabled button
 * advertising a feature the household has not chosen to run is the latter.
 */

async function openACase(page: Page, title: string) {
  await page.goto("/cases");
  await expect(page.getByRole("button", { name: "Open a case", exact: true })).toBeEnabled();
  await page.getByLabel("What is this about?").fill(title);
  await page.getByRole("button", { name: "Open a case", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: title }).getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

test("shows no assistant at all when none is configured", async ({ page }) => {
  await openACase(page, `Kein Assistent ${Date.now()}`);

  // Not disabled, not explained, not there.
  await expect(page.getByRole("heading", { name: "Assistant" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask for a suggestion" })).toHaveCount(0);
  await expect(page.getByText(/A model can propose/)).toHaveCount(0);
});

test("the case still works completely without one", async ({ page }) => {
  const title = `Ohne Assistent ${Date.now()}`;
  await openACase(page, title);

  // The point of "cannot be required for core operation": every ordinary
  // thing on this page works with no model anywhere near it.
  await page.getByLabel("Next action").fill("Bescheid anfordern");
  await page.getByRole("button", { name: "Save next action" }).click();
  await expect(page.getByLabel("Next action")).toHaveValue("Bescheid anfordern");

  await page.getByLabel("Add a note").fill("Widerspruch abgeschickt");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByText("Widerspruch abgeschickt")).toBeVisible();
});

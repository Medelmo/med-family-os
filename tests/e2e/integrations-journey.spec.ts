import { expect, test, type Page } from "@playwright/test";

/**
 * Integrations end to end against a production build.
 *
 * There is no Paperless here, so a sync will fail — and that is the
 * interesting half: the household should be told clearly, the failure
 * should be recorded where "is this working?" can be answered from it, and
 * the token must not appear anywhere on the page.
 */

const TOKEN = "e2e-paperless-token-value";

async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

async function connect(page: Page, name: string) {
  await page.goto("/settings/integrations");
  await formReady(page, "Connect a system");

  await page.getByLabel("What should it be called here?").fill(name);
  // A host that resolves to nothing, so the sync fails at the network
  // rather than reaching anybody's real Paperless.
  await page.getByLabel("Address").fill("http://paperless.invalid");
  await page.getByLabel("API token", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Connect a system", exact: true }).click();

  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

test("connects a system and never shows the token again", async ({ page }) => {
  const name = `Paperless ${Date.now()}`;
  await connect(page, name);

  await expect(card(page, name).getByText("On", { exact: true })).toBeVisible();
  await expect(card(page, name).getByText("Never synced.")).toBeVisible();

  // The token is write-only: it is sealed on the server and there is no
  // path that reads it back into a page.
  expect(await page.content()).not.toContain(TOKEN);
});

test("the token field is not readable over the shoulder", async ({ page }) => {
  await page.goto("/settings/integrations");
  await formReady(page, "Connect a system");
  await expect(page.getByLabel("API token", { exact: true })).toHaveAttribute("type", "password");
});

test("a failing sync is reported and recorded, without the token", async ({ page }) => {
  const name = `Unreachable ${Date.now()}`;
  await connect(page, name);

  await card(page, name).getByRole("button", { name: "Sync now" }).click();

  // Said in the app's own words, not the provider's — an upstream message
  // can name the URL it was called with, and a URL can carry a credential.
  await expect(card(page, name).getByText("Failed", { exact: true })).toBeVisible();
  await expect(card(page, name).getByText(/could not be reached/i)).toBeVisible();

  // And it is recorded, so "is this working?" is answerable afterwards.
  await page.reload();
  await expect(card(page, name).getByText("Failed", { exact: true })).toBeVisible();

  expect(await page.content()).not.toContain(TOKEN);
});

test("a switched-off integration offers no sync", async ({ page }) => {
  const name = `Switchable ${Date.now()}`;
  await connect(page, name);

  await card(page, name).getByRole("button", { name: "Switch off" }).click();

  await expect(card(page, name).getByText("Off", { exact: true })).toBeVisible();
  await expect(card(page, name).getByRole("button", { name: "Sync now" })).toHaveCount(0);

  await card(page, name).getByRole("button", { name: "Switch on" }).click();
  await expect(card(page, name).getByRole("button", { name: "Sync now" })).toBeVisible();
});

test("replacing a token leaves the rest of the connection alone", async ({ page }) => {
  const name = `Rotatable ${Date.now()}`;
  await connect(page, name);

  await card(page, name).getByRole("group").filter({ hasText: "Replace the token" }).click();
  await card(page, name).getByLabel("New API token").fill("a-different-token");
  await card(page, name).getByRole("button", { name: "Replace the token", exact: true }).click();

  await expect(card(page, name).getByText("http://paperless.invalid")).toBeVisible();
  expect(await page.content()).not.toContain("a-different-token");
});

test("documents says where they would come from when there are none", async ({ page }) => {
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Paperless to bring them in" })).toBeVisible();
});

test("the settings index leads to integrations", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: "Integrations" }).click();
  await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
});

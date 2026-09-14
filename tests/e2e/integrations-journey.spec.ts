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

/**
 * A line of the connection's own summary.
 *
 * Still scoped to a paragraph even though the summary and the select no
 * longer share wording: the card contains a form, and "a line of the
 * summary" is what these assertions mean.
 */
const summary = (page: Page, name: string, text: string) => card(page, name).locator("p", { hasText: text });

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

test("a household turns unattended syncing on, and can see that it is on", async ({ page }) => {
  const name = `Scheduled ${Date.now()}`;
  await connect(page, name);

  // Off until asked for. A connection must not start contacting somebody
  // else's server because it exists.
  //
  // Scoped to the summary paragraph: the select's own "Only when asked"
  // option carries the same words, and a bare text match finds both.
  await expect(summary(page, name, "Syncs only when asked")).toBeVisible();

  await card(page, name).getByRole("group").filter({ hasText: "Sync by itself" }).click();
  await card(page, name).getByLabel("How often?").selectOption("60");
  await card(page, name).getByRole("button", { name: "Save the schedule", exact: true }).click();

  // Visible in the summary without opening anything: whether this is
  // talking to another machine on its own is not a detail to bury.
  await expect(card(page, name).getByText("Syncs by itself every hour")).toBeVisible();

  await page.reload();
  await expect(card(page, name).getByText("Syncs by itself every hour")).toBeVisible();
});

test("and turns it off again", async ({ page }) => {
  const name = `Unscheduled ${Date.now()}`;
  await connect(page, name);

  const schedule = card(page, name).getByRole("group").filter({ hasText: "Sync by itself" });
  await schedule.click();

  await card(page, name).getByLabel("How often?").selectOption("1440");
  await card(page, name).getByRole("button", { name: "Save the schedule", exact: true }).click();
  await expect(card(page, name).getByText("Syncs by itself once a day")).toBeVisible();

  await card(page, name).getByLabel("How often?").selectOption("");
  await card(page, name).getByRole("button", { name: "Save the schedule", exact: true }).click();
  await expect(summary(page, name, "Syncs only when asked")).toBeVisible();
});

// The floor exists to protect the household's own server, so the UI does
// not offer a way to ask for less. A free number field would invite "5"
// and then refuse it.
test("does not offer an interval below the floor", async ({ page }) => {
  const name = `Floor ${Date.now()}`;
  await connect(page, name);

  await card(page, name).getByRole("group").filter({ hasText: "Sync by itself" }).click();

  const values = await card(page, name)
    .getByLabel("How often?")
    .evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.value));

  expect(values).toEqual(["", "15", "60", "360", "1440"]);
  expect(values.filter((v) => v !== "").every((v) => Number(v) >= 15)).toBe(true);
});

test("connects a Nextcloud folder, and says what is missing when the account is not given", async ({ page }) => {
  const name = `Cloud ${Date.now()}`;
  await page.goto("/settings/integrations");
  await formReady(page, "Connect a system");

  await page.getByLabel("Which system?").selectOption("NEXTCLOUD");
  await page.getByLabel("What should it be called here?").fill(name);
  await page.getByLabel("Address").fill("http://cloud.invalid");
  await page.getByLabel("API token", { exact: true }).fill(TOKEN);
  // Deliberately no account.
  await page.getByRole("button", { name: "Connect a system", exact: true }).click();

  // Told at the point it can be fixed, rather than at every sync with a
  // message about WebDAV.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name, level: 2 })).toHaveCount(0);

  // Filled from scratch rather than relying on what survived — the
  // retention itself is asserted by its own test below, and this one is
  // about recovering from the rejection.
  await page.getByLabel("Which system?").selectOption("NEXTCLOUD");
  await page.getByLabel("What should it be called here?").fill(name);
  await page.getByLabel("Address").fill("http://cloud.invalid");
  await page.getByLabel(/^Nextcloud account/).fill("ada");
  await page.getByLabel(/^Folder/).fill("Documents/Household");
  await page.getByLabel("API token", { exact: true }).fill(TOKEN);
  await page.getByRole("button", { name: "Connect a system", exact: true }).click();

  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  await expect(card(page, name).getByText("NEXTCLOUD · http://cloud.invalid")).toBeVisible();

  // The app password is write-only, like every other credential here.
  expect(await page.content()).not.toContain(TOKEN);
});

test("a Nextcloud sync failure is reported in the app's own words", async ({ page }) => {
  const name = `Cloud down ${Date.now()}`;
  await page.goto("/settings/integrations");
  await formReady(page, "Connect a system");

  await page.getByLabel("Which system?").selectOption("NEXTCLOUD");
  await page.getByLabel("What should it be called here?").fill(name);
  await page.getByLabel("Address").fill("http://cloud.invalid");
  await page.getByLabel("API token", { exact: true }).fill(TOKEN);
  await page.getByLabel(/^Nextcloud account/).fill("ada");
  await page.getByRole("button", { name: "Connect a system", exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();

  await card(page, name).getByRole("button", { name: "Sync now" }).click();

  await expect(card(page, name).getByText("Failed", { exact: true })).toBeVisible();
  await expect(card(page, name).getByText(/could not be reached/i)).toBeVisible();
  expect(await page.content()).not.toContain(TOKEN);
});

/**
 * React 19 resets an uncontrolled form once its action completes, whether
 * or not it succeeded — so a rejected submit used to erase the address,
 * the name and the folder along with the error. Found by a Nextcloud test
 * that filled in the missing field and submitted again, only for the
 * second attempt to fail with everything else now blank.
 */
test("a rejected connect form keeps what was typed, but not the token", async ({ page }) => {
  const name = `Kept ${Date.now()}`;
  await page.goto("/settings/integrations");
  await formReady(page, "Connect a system");

  await page.getByLabel("Which system?").selectOption("NEXTCLOUD");
  await page.getByLabel("What should it be called here?").fill(name);
  await page.getByLabel("Address").fill("http://cloud.invalid");
  await page.getByLabel("API token", { exact: true }).fill(TOKEN);
  await page.getByLabel(/^Folder/).fill("Documents/Household");
  // No account, so this is refused.
  await page.getByRole("button", { name: "Connect a system", exact: true }).click();

  await expect(page.getByRole("alert")).toBeVisible();

  // The select especially. A `<select>` has no `value` attribute for
  // React to update, so its default is set at mount only — every text
  // field came back and the provider silently reverted to Paperless,
  // which would have built a different kind of connection on resubmit
  // without saying so. Fixed in SelectField, asserted here.
  await expect(page.getByLabel("Which system?")).toHaveValue("NEXTCLOUD");
  await expect(page.getByLabel("What should it be called here?")).toHaveValue(name);
  await expect(page.getByLabel("Address")).toHaveValue("http://cloud.invalid");
  await expect(page.getByLabel(/^Folder/)).toHaveValue("Documents/Household");

  // The one thing deliberately not handed back: echoing it would put a
  // credential into the rendered HTML.
  await expect(page.getByLabel("API token", { exact: true })).toHaveValue("");
  expect(await page.content()).not.toContain(TOKEN);
  await expect(page.getByText(/token was not kept/i)).toBeVisible();
});

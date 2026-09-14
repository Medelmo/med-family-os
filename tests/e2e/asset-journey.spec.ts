import { expect, test, type Page } from "@playwright/test";

/**
 * Assets end to end against a production build: record something, record
 * what covers it and what has been done to it, and eventually record that
 * it is gone (implementation-plan.md vertical slice 7).
 */

const assetCard = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

async function addAsset(page: Page, name: string, categoryLabel = "Appliance") {
  await page.goto("/assets");
  await formReady(page, "Add something");
  await page.getByLabel("What is it?").fill(name);
  await page.getByLabel("Category").selectOption({ label: categoryLabel });
  await page.getByRole("button", { name: "Add something", exact: true }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

async function openAsset(page: Page, name: string) {
  await page.getByRole("link", { name }).click();
  // The list renders each name as an h2 wrapping the link, so the level
  // matters — otherwise the assertion passes without leaving the list.
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

test("records an asset and shows it has no cover and no service due", async ({ page }) => {
  const name = `Dishwasher ${Date.now()}`;
  await addAsset(page, name);

  const card = assetCard(page, name);
  await expect(card.getByText("No warranty recorded")).toBeVisible();
  await expect(card.getByText("No service due")).toBeVisible();
});

test("records cover, and says when it has run out", async ({ page }) => {
  const name = `Washer ${Date.now()}`;
  await addAsset(page, name);
  await openAsset(page, name);

  await formReady(page, "Add cover");
  await page.getByLabel("Who is the cover with?").fill("Miele");
  await page.getByLabel("Cover from").fill("2020-01-01");
  await page.getByLabel("Cover until").fill("2030-01-01");
  await page.getByLabel("Their reference").fill("WR-123456");
  await page.getByRole("button", { name: "Add cover", exact: true }).click();

  // The state is spelled out, never signalled by colour alone.
  await expect(page.getByText("Still covered")).toBeVisible();
  await expect(page.getByText("WR-123456")).toBeVisible();

  // A second, already-expired cover does not change the answer: the
  // household is protected until the later one runs out.
  await page.getByLabel("Who is the cover with?").fill("MediaMarkt");
  await page.getByLabel("Cover from").fill("2020-01-01");
  await page.getByLabel("Cover until").fill("2021-01-01");
  await page.getByRole("button", { name: "Add cover", exact: true }).click();

  await expect(page.getByText("Expired")).toBeVisible();
  await page.goto("/assets");
  await expect(assetCard(page, name).getByText("Covered until 2030-01-01")).toBeVisible();
});

test("a service record is something that already happened", async ({ page }) => {
  const name = `Boiler ${Date.now()}`;
  await addAsset(page, name);
  await openAsset(page, name);

  await formReady(page, "Record a service");
  await page.getByLabel("What was done?").fill("Annual service");
  await page.getByLabel("When", { exact: true }).fill("2026-01-15");
  await page.getByLabel("Who did it").fill("Heizung Schmidt");
  await page.getByLabel("Next one due").fill("2027-01-15");
  await page.getByRole("button", { name: "Record a service", exact: true }).click();

  await expect(page.getByText("Heizung Schmidt")).toBeVisible();
  await expect(page.getByText("Next service due 2027-01-15")).toBeVisible();

  // Each service supersedes the plan the one before it set.
  await page.getByLabel("What was done?").fill("Replaced the pump");
  await page.getByLabel("When", { exact: true }).fill("2026-03-01");
  await page.getByLabel("Next one due").fill("2026-09-01");
  await page.getByRole("button", { name: "Record a service", exact: true }).click();

  await expect(page.getByText("Next service due 2026-09-01")).toBeVisible();
});

test("refuses a next service due before the service itself", async ({ page }) => {
  const name = `Oven ${Date.now()}`;
  await addAsset(page, name);
  await openAsset(page, name);

  await formReady(page, "Record a service");
  await page.getByLabel("What was done?").fill("Cleaned");
  await page.getByLabel("When", { exact: true }).fill("2026-03-01");
  await page.getByLabel("Next one due").fill("2026-01-01");
  await page.getByRole("button", { name: "Record a service", exact: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: "cannot be due before" })).toBeVisible();
});

test("records that something has gone, and stops listing it", async ({ page }) => {
  const name = `Old dryer ${Date.now()}`;
  await addAsset(page, name);
  await openAsset(page, name);

  await formReady(page, "Record as gone");
  await page.getByLabel("Gone on").fill("2026-02-01");
  await page.getByLabel("What happened to it").fill("Sold");
  await page.getByRole("button", { name: "Record as gone", exact: true }).click();

  await expect(page.getByText("No longer owned as of 2026-02-01")).toBeVisible();
  // The forms are gone too: there is nothing to service or cover any more.
  await expect(page.getByRole("button", { name: "Add cover", exact: true })).toHaveCount(0);

  await page.goto("/assets");
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});

// The detail page lives behind a dynamic route the page-level overflow
// loop cannot reach.
test("the asset detail page does not scroll horizontally", async ({ page }) => {
  const name = `Overflow ${Date.now()}`;
  await addAsset(page, name);
  await openAsset(page, name);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("an empty assets page is a good state, not an error", async ({ page }) => {
  await page.goto("/assets");
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
});

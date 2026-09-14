import { expect, test, type Page } from "@playwright/test";

/**
 * Global search end to end against a production build
 * (docs/design/screen-inventory.md §4).
 *
 * The integration suite already proves what search finds and what it
 * refuses to reveal. What only a browser can prove is the part this page
 * was designed around: it is a plain GET form, so it must work as a
 * *document* — addressable, back-navigable, and submitting without any
 * JavaScript at all.
 */

async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

async function openCase(page: Page, title: string) {
  await page.goto("/cases");
  await formReady(page, "Open a case");
  await page.getByLabel("What is this about?").fill(title);
  await page.getByRole("button", { name: "Open a case", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
}

test("searches for a case and opens it from the results", async ({ page }) => {
  const term = `Zahnarzt${Date.now()}`;
  await openCase(page, `${term} appeal`);

  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill(term);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  // The term is in the address, so the result list is a place.
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${term}`));
  await expect(page.getByRole("heading", { name: "1 result" })).toBeVisible();
  await expect(page.getByText("Case", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: `${term} appeal` }).click();
  await expect(page.getByRole("heading", { name: `${term} appeal`, level: 1 })).toBeVisible();

  // And back returns to the results, still filled in — the browser's own
  // behaviour, which a Server Action would have taken away.
  await page.goBack();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue(term);
});

test("a search can be linked to directly", async ({ page }) => {
  const term = `Direkt${Date.now()}`;
  await openCase(page, `${term} case`);

  await page.goto(`/search?q=${term}`);

  await expect(page.getByRole("link", { name: `${term} case` })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue(term);
});

test("says plainly when nothing matched, and echoes the term as text", async ({ page }) => {
  await page.goto("/search?q=verynotpresentterm");

  await expect(page.getByText("Nothing matched verynotpresentterm.")).toBeVisible();
  // The results heading, not `getByRole("listitem")`: the navigation is a
  // list too, so a bare list-item count counts the nav and says nothing
  // about results. This same locator is asserted *positively* in the first
  // test, so a zero here means absence rather than a typo.
  await expect(page.getByRole("heading", { name: /result/ })).toHaveCount(0);
});

test("an empty search invites one instead of reporting no results", async ({ page }) => {
  await page.goto("/search");

  await expect(page.getByText(/Type something to search/)).toBeVisible();
  await expect(page.getByText(/Nothing matched/)).toHaveCount(0);
});

// The one thing the rest of this app cannot claim. Every other form in it
// is a Server Action and is inert until React hydrates; this page is a
// document, and the browser submits it.
test("submits with JavaScript disabled", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: test.info().project.use.storageState,
  });
  const page = await context.newPage();

  try {
    await page.goto("/search");
    await page.getByRole("searchbox", { name: "Search" }).fill("appeal");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page).toHaveURL(/\/search\?q=appeal/);
    // Something in this suite is always called "… appeal"; the point is
    // that a request happened at all and came back rendered.
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the results do not scroll horizontally", async ({ page }) => {
  const term = `Breit${Date.now()}`;
  await openCase(page, `${term} a deliberately long case title that has to wrap somewhere sensible`);

  await page.goto(`/search?q=${term}`);
  await expect(page.getByRole("heading", { name: "1 result" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

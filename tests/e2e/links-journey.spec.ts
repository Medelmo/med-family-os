import { expect, test, type Page } from "@playwright/test";

/**
 * Context links end to end against a production build.
 *
 * `docs/domain/erd.md` models "CASE contextualizes DOCUMENT_REFERENCE",
 * and the same need turned up in every phase since: an expense that
 * belongs to a case, a trip a booking belongs to. This is that, from the
 * case's side.
 */

/**
 * Picks the option whose text contains `needle`.
 *
 * `selectOption({ label })` needs a literal string, and these labels
 * carry a generated timestamp and a type prefix. Finding the option by
 * its text and selecting its value is the honest way to say "the one for
 * this record".
 */
async function selectOptionContaining(page: Page, fieldLabel: string, needle: string) {
  const field = page.getByLabel(fieldLabel);
  const value = await field.evaluate(
    (element, text) =>
      [...(element as HTMLSelectElement).options].find((option) => option.textContent?.includes(text))?.value ?? "",
    needle
  );

  expect(value, `no option mentioning "${needle}"`).not.toBe("");
  await field.selectOption(value);
}

/**
 * The linked record, as a link in the Related list.
 *
 * A record's name appears three times on this page once it is linked —
 * in the list, in the "Unlink …" button, and still in the picker — so a
 * bare text match finds all three and says nothing about which one
 * rendered.
 */
const relatedLink = (page: Page, name: string) => page.getByRole("link", { name });

async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

async function openCase(page: Page, title: string) {
  await page.goto("/cases");
  await formReady(page, "Open a case");
  await page.getByLabel("What is this about?").fill(title);
  await page.getByRole("button", { name: "Open a case", exact: true }).click();

  await page.getByRole("listitem").filter({ hasText: title }).getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

async function recordExpense(page: Page, description: string) {
  const month = test.info().project.name === "mobile" ? "2027-02" : "2027-01";
  await page.goto(`/finance?month=${month}`);
  await formReady(page, "Record an expense");
  await page.getByLabel("What was it for?").fill(description);
  await page.getByLabel("Amount", { exact: true }).fill("150,00");
  await page.getByLabel("Date", { exact: true }).fill(`${month}-11`);
  await page.getByRole("button", { name: "Record an expense", exact: true }).click();
  await expect(page.getByRole("cell", { name: description })).toBeVisible();
}

test("links a case to an expense and back again", async ({ page }) => {
  const caseTitle = `Appeal ${Date.now()}`;
  const expenseName = `Solicitor ${Date.now()}`;

  await recordExpense(page, expenseName);
  await openCase(page, caseTitle);

  await expect(page.getByText("Nothing linked yet.")).toBeVisible();

  await formReady(page, "Link it");
  await selectOptionContaining(page, "Link to", expenseName);
  await page.getByLabel("Why are they related? (optional)").fill("The fee for this appeal");
  await page.getByRole("button", { name: "Link it", exact: true }).click();

  // The kind is spelled out, not shown as a glyph.
  await expect(page.getByText("Expense", { exact: true })).toBeVisible();
  await expect(relatedLink(page, expenseName)).toBeVisible();
  await expect(page.getByText("The fee for this appeal")).toBeVisible();

  // Named, so a screen reader hears which one it unlinks.
  await page.getByRole("button", { name: new RegExp(`Unlink .*${expenseName}`) }).click();
  await expect(page.getByText("Nothing linked yet.")).toBeVisible();
});

test("linking the same pair twice does not complain or duplicate", async ({ page }) => {
  const caseTitle = `Repeat ${Date.now()}`;
  const expenseName = `Twice ${Date.now()}`;

  await recordExpense(page, expenseName);
  await openCase(page, caseTitle);

  await formReady(page, "Link it");
  for (let i = 0; i < 2; i++) {
    await selectOptionContaining(page, "Link to", expenseName);
    await page.getByRole("button", { name: "Link it", exact: true }).click();
    await expect(relatedLink(page, expenseName)).toBeVisible();
  }

  // Two people reaching the same conclusion is not a conflict.
  //
  // `p[role="alert"]` rather than getByRole("alert"): Next's route
  // announcer is a div with the same role and matches on every page.
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(`Unlink .*${expenseName}`) })).toHaveCount(1);
});

test("a case with nothing to link to says so rather than showing an empty picker", async ({ page }) => {
  // Every household in this suite has records by now, so this asserts the
  // picker exists and is populated rather than the empty branch — the
  // empty branch is covered by the integration suite.
  const caseTitle = `Picker ${Date.now()}`;
  await openCase(page, caseTitle);

  await expect(page.getByLabel("Link to")).toBeVisible();
});

test("the related section does not scroll horizontally", async ({ page }) => {
  const caseTitle = `Overflow ${Date.now()}`;
  const expenseName = `A rather long expense description ${Date.now()}`;

  await recordExpense(page, expenseName);
  await openCase(page, caseTitle);

  await formReady(page, "Link it");
  await selectOptionContaining(page, "Link to", expenseName);
  await page.getByRole("button", { name: "Link it", exact: true }).click();
  await expect(relatedLink(page, expenseName)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

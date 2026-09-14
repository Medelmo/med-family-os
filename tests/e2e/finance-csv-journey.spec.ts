import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SIGNED_OUT_STATE } from "./helpers";

/**
 * Import and export end to end against a production build.
 *
 * The point of the journey is the promise ADR-015 makes: a file is read
 * and shown before anything is written, so a misread amount is caught by a
 * person rather than discovered a month later in a budget total.
 */

function monthFor(): string {
  return test.info().project.name === "mobile" ? "2026-09" : "2026-08";
}

/**
 * The two tables on this page hold the same descriptions — one shows what
 * a file *would* add, the other what the month already has. Telling them
 * apart is the whole assertion in places, so every row lookup is scoped to
 * the right one by its caption.
 */
const previewTable = (page: Page) => page.getByRole("table", { name: /how it was read/ });
const expensesTable = (page: Page) => page.getByRole("table", { name: /Expenses recorded in/ });

async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

async function uploadCsv(page: Page, name: string, body: string) {
  await page.goto(`/finance?month=${monthFor()}`);
  await formReady(page, "Read the file");
  await page.getByLabel("CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(body, "utf8"),
  });
  await page.getByRole("button", { name: "Read the file", exact: true }).click();
}

test("reads a file, shows what it would do, and only writes when told", async ({ page }) => {
  const month = monthFor();
  const good = `Physio ${Date.now()}`;
  const broken = `Broken ${Date.now()}`;

  // A German file: semicolons, comma decimals, dotted dates — the format
  // this household's bank actually exports.
  await uploadCsv(
    page,
    "ausgaben.csv",
    [
      "Datum;Beschreibung;Betrag;Kategorie",
      `12.${month.slice(5)}.${month.slice(0, 4)};${good};89,90;HEALTH`,
      `13.${month.slice(5)}.${month.slice(0, 4)};${broken};keine Ahnung;`,
    ].join("\r\n")
  );

  await expect(page.getByRole("heading", { name: "What this file would add" })).toBeVisible();

  // The preview is markup that only exists after an upload, so the page's
  // own axe sweep never sees it.
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  // The preview table has five columns and appears only after an upload,
  // so the page-level overflow guard never sees it. It may scroll inside
  // its own container; the page may not.
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector('div[class*="tableScroll"]');
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollerExists: scroller !== null,
    };
  });
  expect(overflow.scrollerExists).toBe(true);
  expect(overflow.page).toBeLessThanOrEqual(1);

  // The interpreted amount is on screen before anything is stored — the
  // whole reason this step exists.
  const goodRow = previewTable(page).getByRole("row").filter({ hasText: good });
  await expect(goodRow.locator("data")).toHaveAttribute("value", "89.9");
  await expect(goodRow).toContainText("Will be imported");

  // A row that cannot be read is reported, never silently dropped.
  await expect(previewTable(page).getByRole("row").filter({ hasText: broken })).toContainText(
    "Amount not understood"
  );

  // Nothing has been written yet.
  await expect(expensesTable(page).getByRole("cell", { name: good })).toHaveCount(0);

  await page.getByRole("button", { name: "Import 1 expense", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1 expense");

  await page.goto(`/finance?month=${month}`);
  await expect(expensesTable(page).getByRole("cell", { name: good })).toBeVisible();
});

test("says what is wrong with a file it cannot use", async ({ page }) => {
  await uploadCsv(page, "wrong.csv", "Foo,Bar\n1,2");
  await expect(page.getByRole("alert").filter({ hasText: "missing columns" })).toBeVisible();
});

test("flags a row the household already has, without refusing it", async ({ page }) => {
  const month = monthFor();
  const description = `Repeat ${Date.now()}`;
  const csv = ["Date,Description,Amount", `${month}-05,${description},12.34`].join("\n");

  await uploadCsv(page, "first.csv", csv);
  await page.getByRole("button", { name: "Import 1 expense", exact: true }).click();
  await expect(page.getByRole("status")).toBeVisible();

  await uploadCsv(page, "again.csv", csv);
  await expect(previewTable(page).getByRole("row").filter({ hasText: description })).toContainText(
    "already have"
  );
});

test("exports the month as a CSV the importer can read back", async ({ page }) => {
  const month = monthFor();

  // Goes through the browser's own session, so this also proves the
  // endpoint is reachable only as a signed-in member.
  const response = await page.request.get(`/api/finance/expenses?month=${month}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(response.headers()["content-disposition"]).toContain(`expenses-${month}.csv`);
  // Household finances must not sit in a shared cache.
  expect(response.headers()["cache-control"]).toContain("no-store");

  const body = await response.text();
  expect(body.split("\r\n")[0]).toBe("Date,Description,Amount,Currency,Category,Merchant");
});

test("refuses an export request with no usable month", async ({ page }) => {
  expect((await page.request.get("/api/finance/expenses")).status()).toBe(400);
  expect((await page.request.get("/api/finance/expenses?month=banana")).status()).toBe(400);
});

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT_STATE });

  // The household's spending must not be one unauthenticated GET away.
  // The proxy redirects first, so this asserts what actually happens
  // rather than the handler's own 401 — either way, no CSV comes back.
  test("does not hand the export to someone with no session", async ({ page }) => {
    const response = await page.request.get("/api/finance/expenses?month=2026-08", { maxRedirects: 0 });
    expect(response.status()).not.toBe(200);
    expect(response.headers()["content-type"] ?? "").not.toContain("text/csv");
  });
});

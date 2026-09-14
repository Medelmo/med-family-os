import { expect, test, type Page } from "@playwright/test";

/**
 * Export and backup status end to end (screens 48 and 49).
 *
 * The integration suite proves what the bundle contains and refuses to
 * contain. What only a browser can prove is that the download is a real
 * download — a response with its own headers, not a base64 blob held in
 * page memory — and that nobody clicks it without first being told the
 * file is not encrypted.
 */

async function openExport(page: Page) {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Take your data out" }).click();
  await expect(page.getByRole("heading", { name: "Take your data out", level: 1 })).toBeVisible();
}

test("says what the file will contain before offering it", async ({ page }) => {
  await openExport(page);

  await expect(page.getByRole("table")).toBeVisible();
  // People, not Cases: the setup project creates two household members, so
  // this row exists whatever else has or has not run. The first version
  // asserted on Cases and passed only when the case journey happened to
  // run first — a test that depends on another spec file's leftovers is
  // one that will fail the day somebody runs it alone.
  await expect(page.getByRole("rowheader", { name: "People" })).toBeVisible();

  // Both caveats, before the button rather than after the download.
  await expect(page.getByText(/not encrypted/i)).toBeVisible();
  await expect(page.getByText(/what you are permitted to see/i)).toBeVisible();
});

test("downloads a readable bundle with the right headers", async ({ page }) => {
  await openExport(page);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download the file" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^med-family-os-export-\d{4}-\d{2}-\d{2}\.json$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bundle = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  expect(bundle.formatVersion).toBe(1);
  // The caveat travels with the file, because a file outlives the page.
  expect(bundle.scope).toMatch(/permitted to read/i);
  expect(Array.isArray(bundle.cases)).toBe(true);
  // Never the internals.
  expect(JSON.stringify(bundle)).not.toContain("searchVector");
  expect(JSON.stringify(bundle)).not.toContain("passwordHash");
});

test("the export response is never cached", async ({ page }) => {
  await openExport(page);

  const response = await page.request.get("/api/export");
  expect(response.status()).toBe(200);
  // The household's records in plain text: a proxy or browser cache
  // holding a copy is a copy nobody knows about.
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("backup status reports what the app knows and refuses to claim more", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Backup and restore" }).click();
  await expect(page.getByRole("heading", { name: "Backup and restore", level: 1 })).toBeVisible();

  // No green tick for a job this process cannot see.
  await expect(page.getByText(/does not take the backups/i)).toBeVisible();

  // The one mistake that looks correct until the dump is stolen.
  await expect(page.getByText(/CREDENTIAL_KEYS must be kept somewhere/i)).toBeVisible();

  // The numbers the restore drill asks to compare against.
  await expect(page.getByRole("rowheader", { name: "household_case" })).toBeVisible();
  await expect(page.getByText("Schema version")).toBeVisible();
});

test("neither settings page scrolls horizontally", async ({ page }) => {
  for (const path of ["/settings/export", "/settings/backup"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});

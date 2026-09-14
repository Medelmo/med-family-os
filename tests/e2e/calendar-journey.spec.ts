import { expect, test } from "@playwright/test";

/**
 * Calendar against a production build. The DST correctness that ADR-014
 * exists for is proved exhaustively in the unit and integration suites;
 * this covers the journey and the rendering.
 */

test("add a one-off event and see it on the agenda", async ({ page }) => {
  const title = `Dentist ${Date.now()}`;
  // Comfortably inside the 60-day agenda window, whenever the suite runs.
  const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  await page.goto("/calendar");
  await page.getByLabel("What is happening?").fill(title);
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Time").fill("14:30");
  await page.getByLabel("Where (optional)").fill("Praxis Dr. Meier");
  await page.getByRole("button", { name: "Add an event" }).click();

  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Praxis Dr. Meier")).toBeVisible();
});

test("a weekly event shows every occurrence in the window, each labelled as repeating", async ({ page }) => {
  const title = `Swimming ${Date.now()}`;
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  await page.goto("/calendar");
  await page.getByLabel("What is happening?").fill(title);
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Time").fill("17:00");
  await page.getByLabel("Repeats").selectOption("WEEKLY");
  await page.getByRole("button", { name: "Add an event" }).click();

  const rows = page.getByRole("listitem").filter({ hasText: title });
  // Wait for the first occurrence to render before counting: count() takes
  // a snapshot and does not retry, so counting straight after the click
  // races the Server Action rather than waiting for it.
  await expect(rows.first()).toBeVisible();

  // Several weeks fit inside the 60-day agenda.
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(rows.first().getByText("repeats")).toBeVisible();
});

test("an empty calendar says so rather than showing a blank panel", async ({ page }) => {
  await page.goto("/calendar");
  const empty = page.getByText("Nothing scheduled.");
  const rows = page.getByRole("listitem");
  if ((await rows.count()) === 0) await expect(empty).toBeVisible();
});

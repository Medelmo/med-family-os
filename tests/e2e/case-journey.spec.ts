import { expect, test } from "@playwright/test";

/**
 * Cases end to end against a production build: open a case, park it on
 * someone with the follow-up the domain insists on, note what happened,
 * and see it explained on Attention
 * (docs/implementation/implementation-plan.md vertical slice 3).
 */

test("open a case, park it on someone, and see it explained on Attention", async ({ page }) => {
  const subject = `Kindergarten ${Date.now()}`;

  await page.goto("/cases");
  await page.getByLabel("What is this about?").fill(subject);
  await page.getByRole("button", { name: "Open a case" }).click();

  const row = page.getByRole("listitem").filter({ hasText: subject });
  await expect(row).toBeVisible();
  // A case with nothing decided says so, rather than looking complete.
  await expect(row.getByText("No next action decided")).toBeVisible();

  await row.getByRole("link", { name: subject }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();

  // The domain refuses an open-ended wait with no stated reason...
  await page.getByRole("button", { name: "Waiting on someone" }).click();
  await page.getByLabel("Waiting for").fill("the council");
  await page.getByRole("button", { name: "Waiting on someone" }).nth(1).click();
  await expect(page.getByRole("alert").filter({ hasText: /follow-up date/ })).toBeVisible();

  // ...but accepts one with an explicit reason.
  await page.getByLabel("Waiting for").fill("the council");
  await page.getByLabel("…or why there is no follow-up date").fill("they will write to us");
  await page.getByRole("button", { name: "Waiting on someone" }).nth(1).click();
  await expect(page.getByText("Waiting", { exact: true })).toBeVisible();

  // The wait is visible on Attention with the reason it was flagged.
  await page.goto("/attention");
  const attentionCard = page.getByRole("listitem").filter({ hasText: subject });
  await expect(attentionCard).toBeVisible();
  await expect(attentionCard.getByText("Waiting with no follow-up date")).toBeVisible();
});

test("the case state machine drives which actions are offered", async ({ page }) => {
  const subject = `Passport case ${Date.now()}`;

  await page.goto("/cases");
  await page.getByLabel("What is this about?").fill(subject);
  await page.getByRole("button", { name: "Open a case" }).click();
  await page.getByRole("listitem").filter({ hasText: subject }).getByRole("link", { name: subject }).click();

  // ACTIVE offers resolve; it does not offer archive, which is only
  // reachable from COMPLETED (ADR-007).
  await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);

  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  // A resolved case cannot be reopened — cases differ from tasks here.
  await expect(page.getByRole("button", { name: "Pick it back up" })).toHaveCount(0);

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("This case is closed. Nothing more to do.")).toBeVisible();

  // Archived cases leave the open list.
  await page.goto("/cases");
  await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);
});

test("notes and status changes share one timeline", async ({ page }) => {
  const subject = `Timeline case ${Date.now()}`;

  await page.goto("/cases");
  await page.getByLabel("What is this about?").fill(subject);
  await page.getByRole("button", { name: "Open a case" }).click();
  await page.getByRole("listitem").filter({ hasText: subject }).getByRole("link", { name: subject }).click();

  await page.getByLabel("Add a note").fill("Rang them, nobody picked up.");
  await page.getByRole("button", { name: "Add note" }).click();

  await expect(page.getByText("Rang them, nobody picked up.")).toBeVisible();
  // The creation entry is still there alongside the note.
  await expect(page.getByText("Case opened")).toBeVisible();
});

import { expect, test } from "@playwright/test";

/**
 * The product's core loop end to end: Capture -> Triage -> Execute ->
 * Complete (docs/requirements/product-spec.md primary journeys), against a
 * production build and a real database.
 *
 * Runs with the shared owner session from auth.setup.ts.
 */

test("capture, triage into a task, and see it surface on Today and Attention", async ({ page }) => {
  const subject = `Dentist ${Date.now()}`;

  // Capture — no structure decided yet.
  await page.goto("/inbox");
  await page.getByLabel("What's on your mind?").fill(subject);
  await page.getByRole("button", { name: "Capture" }).click();

  const item = page.getByRole("listitem").filter({ hasText: subject });
  await expect(item).toBeVisible();

  // Triage into a task, with a due date already in the past so the
  // attention rules have something to say about it.
  await item.getByRole("button", { name: "Make it a task" }).click();
  await item.getByLabel("Next action (optional)").fill("Call the clinic");
  await item.getByLabel("Due date (optional)").fill("2020-01-01");
  await item.getByRole("button", { name: "Create task" }).click();

  // It leaves the inbox...
  await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);

  // ...and arrives on Today as due, with its next action intact.
  await page.goto("/today");
  const todayCard = page.getByRole("listitem").filter({ hasText: subject });
  await expect(todayCard).toBeVisible();
  await expect(todayCard.getByText("Call the clinic")).toBeVisible();

  // Attention explains *why* it is flagged rather than showing a score.
  await page.goto("/attention");
  const attentionCard = page.getByRole("listitem").filter({ hasText: subject });
  await expect(attentionCard).toBeVisible();
  await expect(attentionCard.getByText(/overdue/)).toBeVisible();
});

test("the task state machine drives which actions are offered", async ({ page }) => {
  const subject = `Passport ${Date.now()}`;

  await page.goto("/inbox");
  await page.getByLabel("What's on your mind?").fill(subject);
  await page.getByRole("button", { name: "Capture" }).click();

  const item = page.getByRole("listitem").filter({ hasText: subject });
  await item.getByRole("button", { name: "Make it a task" }).click();
  await item.getByRole("button", { name: "Create task" }).click();

  // Wait for the item to actually leave the inbox before navigating:
  // triage is a Server Action, so goto() would otherwise race the write
  // and land on /tasks before the task exists.
  await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);

  await page.goto("/tasks");
  const card = page.getByRole("listitem").filter({ hasText: subject });
  await expect(card.getByText("Planned")).toBeVisible();

  // PLANNED offers Start, not Complete — state-machines.md has no
  // PLANNED -> COMPLETED edge.
  await expect(card.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Complete" })).toHaveCount(0);

  // Starting assigns the acting person as owner, satisfying "IN_PROGRESS
  // requires an owner" without a separate assignment step.
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText("In progress")).toBeVisible();
  await expect(card.getByText("Ada Owner")).toBeVisible();

  await card.getByRole("button", { name: "Complete" }).click();
  // Completed work leaves the open-task list entirely.
  await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);
});

test("an empty Attention list is a good state, not an error", async ({ page }) => {
  await page.goto("/attention");
  // Either it lists flagged work, or it says plainly that nothing is
  // flagged — never a blank panel.
  const empty = page.getByText("Nothing needs attention right now.");
  const items = page.getByRole("listitem");
  const hasItems = (await items.count()) > 0;
  if (!hasItems) await expect(empty).toBeVisible();
});

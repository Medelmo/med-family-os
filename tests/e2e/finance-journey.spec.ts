import { expect, test, type Page } from "@playwright/test";

/**
 * Finance end to end against a production build: record what was spent,
 * see it land against a budget, and chase the money back through the
 * reimbursement state machine (docs/implementation/roadmap.md phase 5).
 *
 * Amounts are asserted on the `<data value>` attribute that
 * components/ui/Money.tsx emits rather than on the rendered string — the
 * rendered string is locale-formatted, and a test that pins it would be
 * asserting Intl's output rather than the application's arithmetic.
 */

/**
 * The claim's status badge specifically. The same words appear again in
 * the claim's history — a plain text match would find both, which is
 * correct behaviour on the page and ambiguous in a test.
 */
/**
 * Waits until a form is actually able to accept input.
 *
 * Its submit button is disabled until the component hydrates (see
 * components/ui/useHydrated.ts), which makes "enabled" an honest signal
 * that the form is live. Typing before that point is not merely ignored on
 * submit — React discards the value when it hydrates the field, so the
 * form would post empty and be refused for a reason that has nothing to do
 * with what the test is checking.
 */
async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

function claimStatus(page: Page) {
  return page.locator("p[data-status]");
}

/**
 * A month of this project's own.
 *
 * The desktop and mobile projects run against one shared database, in
 * sequence, so anything the first writes is still there for the second.
 * Giving each its own month keeps "what was spent this month" a fact about
 * the test rather than about which project ran first — the alternative was
 * assertions that silently depend on run order.
 */
function monthFor(): string {
  return test.info().project.name === "mobile" ? "2026-07" : "2026-05";
}

async function recordExpense(page: Page, description: string, amount: string, category = "Health") {
  const month = monthFor();
  await page.goto(`/finance?month=${month}`);
  await formReady(page, "Record an expense");
  await page.getByLabel("What was it for?").fill(description);
  await page.getByLabel("Amount", { exact: true }).fill(amount);
  await page.getByLabel("Category", { exact: true }).selectOption({ label: category });
  await page.getByLabel("Date", { exact: true }).fill(`${month}-14`);
  await page.getByRole("button", { name: "Record an expense" }).click();
  await expect(page.getByRole("cell", { name: description })).toBeVisible();
}

test("records an expense in the month it happened, parsing a German amount", async ({ page }) => {
  const description = `Physio ${Date.now()}`;
  await recordExpense(page, description, "60,50");

  const row = page.getByRole("row").filter({ hasText: description });
  await expect(row.locator("data")).toHaveAttribute("value", "60.5");

  // The month is part of the URL, so a different month does not show it.
  await page.goto("/finance?month=2026-04");
  await expect(page.getByRole("cell", { name: description })).toHaveCount(0);
});

test("shows spend against a budget envelope, and says when it is over", async ({ page }) => {
  const description = `Groceries ${Date.now()}`;

  const month = monthFor();
  await page.goto(`/finance?month=${month}`);
  await formReady(page, "Set a budget");
  await page.getByLabel("Category to budget").selectOption({ label: "Leisure" });
  await page.getByLabel("Monthly limit").fill("100,00");
  await page.getByLabel("From").fill(`${month}-01`);
  await page.getByRole("button", { name: "Set a budget" }).click();

  await expect(page.getByRole("heading", { name: "Leisure" })).toBeVisible();
  // A fresh envelope with nothing against it is on track...
  await expect(page.getByText("On track")).toBeVisible();

  await recordExpense(page, description, "120,00", "Leisure");

  // ...and the state is spelled out in words, not signalled by colour
  // alone (CLAUDE.md §13).
  await expect(page.getByText("Over budget")).toBeVisible();
});

test("the reimbursement state machine drives which actions are offered", async ({ page }) => {
  const description = `Dentist ${Date.now()}`;
  const claimTitle = `Dental claim ${Date.now()}`;

  await recordExpense(page, description, "200,00");

  await page.goto("/finance/claims");
  await formReady(page, "Open a claim");
  await page.getByLabel("What is the claim for?").fill(claimTitle);
  await page.getByRole("checkbox", { name: new RegExp(description) }).check();
  await page.getByRole("button", { name: "Open a claim" }).click();

  await expect(page.getByRole("link", { name: claimTitle })).toBeVisible();
  await page.getByRole("link", { name: claimTitle }).click();
  await expect(page.getByRole("heading", { name: claimTitle })).toBeVisible();
  await formReady(page, "Submit the claim");

  // PLANNED offers submitting and dropping — never paying, which the
  // domain would refuse.
  await expect(page.getByRole("button", { name: "Submit the claim" })).toBeVisible();
  await expect(page.getByRole("button", { name: "It was paid", exact: true })).toHaveCount(0);

  // The domain refuses to submit without saying who to.
  await page.getByRole("button", { name: "Submit the claim" }).click();
  await expect(page.getByLabel("Who are you claiming from?")).toBeFocused();

  await page.getByLabel("Who are you claiming from?").fill("Krankenkasse");
  await page.getByRole("button", { name: "Submit the claim" }).click();
  await expect(claimStatus(page)).toHaveText("Submitted");

  // SUBMITTED cannot jump to approval — the documented path goes through
  // waiting (docs/domain/state-machines.md).
  await expect(page.getByRole("button", { name: "They approved it" })).toHaveCount(0);

  // A wait needs a date or a stated reason; neither is refused.
  await page.getByRole("button", { name: "Waiting for a decision" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "date" })).toBeVisible();

  await page.getByLabel("Chase on").fill("2026-06-01");
  await page.getByRole("button", { name: "Waiting for a decision" }).click();
  await expect(claimStatus(page)).toHaveText("Waiting");

  await page.getByRole("button", { name: "They approved it" }).click();
  await expect(claimStatus(page)).toHaveText("Approved");

  await page.getByLabel("Amount received").first().fill("180,00");
  await page.getByRole("button", { name: "It was paid", exact: true }).click();
  await expect(claimStatus(page)).toHaveText("Paid");

  // Paid less than claimed is legitimate; the outstanding figure says so.
  const outstanding = page.getByRole("term").filter({ hasText: "Outstanding" });
  await expect(outstanding).toBeVisible();

  await page.getByRole("button", { name: "Close the claim" }).click();
  await expect(claimStatus(page)).toHaveText("Closed");

  // The whole history is on the claim, written as it happened.
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByText("Submitted to Krankenkasse")).toBeVisible();
});

test("a claim whose chase date has passed is explained on Attention", async ({ page }) => {
  const description = `Glasses ${Date.now()}`;
  const claimTitle = `Optician claim ${Date.now()}`;

  await recordExpense(page, description, "300,00");

  await page.goto("/finance/claims");
  await formReady(page, "Open a claim");
  await page.getByLabel("What is the claim for?").fill(claimTitle);
  await page.getByRole("checkbox", { name: new RegExp(description) }).check();
  await page.getByRole("button", { name: "Open a claim" }).click();
  await page.getByRole("link", { name: claimTitle }).click();
  // The detail page has to be there before its fields can be filled: a
  // click on a Link is a client-side navigation, not an instant one.
  await expect(page.getByRole("heading", { name: claimTitle })).toBeVisible();
  await formReady(page, "Submit the claim");

  await page.getByLabel("Who are you claiming from?").fill("Krankenkasse");
  await page.getByRole("button", { name: "Submit the claim" }).click();
  await expect(claimStatus(page)).toHaveText("Submitted");

  // A date already in the past, so the follow-up is due immediately.
  await page.getByLabel("Chase on").fill("2020-01-01");
  await page.getByRole("button", { name: "Waiting for a decision" }).click();
  // The Server Action has to finish before navigating, or the next page is
  // rendered from data the click has not yet written.
  await expect(claimStatus(page)).toHaveText("Waiting");

  await page.goto("/attention");
  await expect(page.getByText(claimTitle)).toBeVisible();
});

test("an empty finance page is a good state, not an error", async ({ page }) => {
  await page.goto("/finance?month=2019-01");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expect(page.getByText("Nothing recorded this month.")).toBeVisible();
  await expect(page.getByText("No expenses in this month.")).toBeVisible();
});

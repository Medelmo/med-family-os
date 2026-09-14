import { expect, test, type Page } from "@playwright/test";

/**
 * Trips end to end against a production build: plan one, record what the
 * household needs from the place, chase an answer, and pack
 * (docs/implementation/implementation-plan.md vertical slice 6).
 *
 * The access requirement is the part worth testing hardest. It is the one
 * thing on a trip that cannot be fixed the night before, and the feature's
 * whole value is that an answer carries who gave it and when.
 */

function datesFor(): { from: string; to: string } {
  // Each project gets its own dates so the two runs, which share one
  // database, cannot read each other's trips.
  return test.info().project.name === "mobile"
    ? { from: "2027-04-10", to: "2027-04-17" }
    : { from: "2027-03-10", to: "2027-03-17" };
}

/**
 * One trip's card in the list. The suite leaves several trips behind, and
 * readiness wording repeats across them, so every list assertion is scoped
 * to the trip it is about.
 */
const tripCard = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

async function formReady(page: Page, submitLabel: string) {
  await expect(page.getByRole("button", { name: submitLabel, exact: true })).toBeEnabled();
}

async function planTrip(page: Page, title: string) {
  const { from, to } = datesFor();
  await page.goto("/trips");
  await formReady(page, "Plan a trip");
  await page.getByLabel("What is the trip?").fill(title);
  await page.getByLabel("Where to (optional)").fill("Vienna");
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
  await page.getByRole("button", { name: "Plan a trip", exact: true }).click();

  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await openTrip(page, title);
}

/**
 * Opens a trip from the list and waits until the detail page is really
 * there.
 *
 * The level matters: the list renders each title as an `h2` wrapping the
 * link, so a bare `getByRole("heading", { name })` is already satisfied on
 * the list page and the assertion passes without waiting for anything.
 * The detail page's title is the `h1`.
 */
async function openTrip(page: Page, title: string) {
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

test("plans a trip and derives its phase from the dates", async ({ page }) => {
  const title = `Vienna ${Date.now()}`;
  await planTrip(page, title);

  const { from, to } = datesFor();
  await expect(page.getByText(`${from} to ${to}`)).toBeVisible();
  // Nothing stores "upcoming" — it is read from today's date (ADR-016).
  await expect(page.getByText("Coming up")).toBeVisible();
  await expect(page.getByText("Planned", { exact: true })).toBeVisible();
});

test("an access requirement needs an answer, and the answer needs a source", async ({ page }) => {
  const title = `Access ${Date.now()}`;
  await planTrip(page, title);

  await page.getByLabel("What does the household need?").fill("Step-free hotel entrance");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  await expect(page.getByText("No answer yet")).toBeVisible();
  // The trip list says so too, because this is the thing that cannot be
  // fixed late.
  await page.goto("/trips");
  await expect(tripCard(page, title).getByText("1 access question with no answer yet")).toBeVisible();

  await openTrip(page, title);

  // An answer with no source is refused by the browser's own validation,
  // because the field is required — the source is the feature.
  await formReady(page, "Record the answer");
  await page.getByRole("button", { name: "Record the answer", exact: true }).click();
  await expect(page.getByLabel("Who confirmed it, and how?")).toBeFocused();

  await page.getByLabel("Who confirmed it, and how?").fill("Phoned the hotel, spoke to Frau Müller");
  await page.getByRole("button", { name: "Record the answer", exact: true }).click();

  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText("Phoned the hotel, spoke to Frau Müller")).toBeVisible();
});

test("records a refusal as an answer rather than an open question", async ({ page }) => {
  const title = `Refused ${Date.now()}`;
  await planTrip(page, title);

  await page.getByLabel("What does the household need?").fill("Lift to the room");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  await formReady(page, "Record the answer");
  await page.getByLabel("Who confirmed it, and how?").fill("They said the lift is out until autumn");
  await page.getByLabel("What did they say?").selectOption({ label: "No, it is not" });
  await page.getByRole("button", { name: "Record the answer", exact: true }).click();

  await expect(page.getByText("Not available")).toBeVisible();

  // Being told "no" is information, not an unfinished task.
  await page.goto("/trips");
  await expect(tripCard(page, title).getByText("access question with no answer yet")).toHaveCount(0);
});

test("packs a list and ticks it off", async ({ page }) => {
  const title = `Packing ${Date.now()}`;
  await planTrip(page, title);

  await page.getByLabel("What needs packing?").fill("Wheelchair charger");
  await page.getByRole("button", { name: "Add", exact: true }).nth(1).click();

  await expect(page.getByRole("button", { name: "Tick off Wheelchair charger" })).toBeVisible();
  await page.goto("/trips");
  await expect(tripCard(page, title).getByText("1 thing still to do")).toBeVisible();

  await openTrip(page, title);
  await page.getByRole("button", { name: "Tick off Wheelchair charger" }).click();

  // The state is spelled out in the button, not signalled by the
  // strikethrough alone (CLAUDE.md §13).
  await expect(page.getByRole("button", { name: "Untick Wheelchair charger" })).toBeVisible();

  await page.goto("/trips");
  await expect(tripCard(page, title).getByText("Ready")).toBeVisible();
});

test("the trip state machine drives which actions are offered", async ({ page }) => {
  const title = `Lifecycle ${Date.now()}`;
  await planTrip(page, title);

  // PLANNED offers confirming and cancelling — never archiving, which the
  // domain would refuse for a trip that has not happened.
  await expect(page.getByRole("button", { name: "Confirm the trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive the trip" })).toHaveCount(0);

  await page.getByRole("button", { name: "Confirm the trip" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();

  // Bookings fall through, so a confirmed trip can go back to planning.
  await expect(page.getByRole("button", { name: "Back to planning" })).toBeVisible();

  // Archiving is offered now, and refused by the domain with a reason.
  await page.getByRole("button", { name: "Archive the trip" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "has not happened yet" })).toBeVisible();
});

// The detail page is the busiest in the app and lives behind a dynamic
// route, so the page-level overflow loop never reaches it.
test("the trip detail page does not scroll horizontally", async ({ page }) => {
  const title = `Overflow ${Date.now()}`;
  await planTrip(page, title);

  await page.getByLabel("What does the household need?").fill("A ground-floor room with a wet room and a hoist");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByText("No answer yet")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("an empty trips page is a good state, not an error", async ({ page }) => {
  await page.goto("/trips");
  await expect(page.getByRole("heading", { name: "Trips" })).toBeVisible();
});

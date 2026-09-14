import { expect, test } from "@playwright/test";
import { SIGNED_OUT_STATE } from "./helpers";

/**
 * The Home Assistant surfaces, end to end against a production build.
 *
 * Two different doors, on purpose (ADR-018): `/api/ha/summary` is for a
 * machine and authenticates with a scoped bearer token; `/ha` is for a
 * tablet and authenticates with a session, because a token in a dashboard
 * URL is a secret in a URL.
 */

const CONFIGURED_TOKEN = process.env.HA_READONLY_TOKEN ?? "";

test.describe("the summary endpoint", () => {
  test.use({ storageState: SIGNED_OUT_STATE });

  // The point of the endpoint: no session, no cookie, just a token.
  test("refuses a request with no token", async ({ page }) => {
    const response = await page.request.get("/api/ha/summary", { maxRedirects: 0 });
    // 401 when a token is configured, 503 when the deployment has not
    // opted in. Never 200, and never a redirect to a sign-in page.
    expect([401, 503]).toContain(response.status());
    expect(await response.text()).not.toContain("<html");
  });

  test("refuses a wrong token", async ({ page }) => {
    const response = await page.request.get("/api/ha/summary", {
      headers: { authorization: `Bearer ${"z".repeat(48)}` },
      maxRedirects: 0,
    });
    expect([401, 503]).toContain(response.status());
  });

  // A token in a query string would end up in the proxy's access log, the
  // browser's history and every screenshot of the dashboard.
  test("ignores a token offered in the query string", async ({ page }) => {
    test.skip(CONFIGURED_TOKEN.length < 32, "needs HA_READONLY_TOKEN to be configured");

    const response = await page.request.get(`/api/ha/summary?token=${CONFIGURED_TOKEN}`, { maxRedirects: 0 });
    expect(response.status()).toBe(401);
  });

  test("answers a correctly presented token with counts and nothing else", async ({ page }) => {
    test.skip(CONFIGURED_TOKEN.length < 32, "needs HA_READONLY_TOKEN to be configured");

    const response = await page.request.get("/api/ha/summary", {
      headers: { authorization: `Bearer ${CONFIGURED_TOKEN}` },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "critical",
      "dueToday",
      "eventsToday",
      "generatedAt",
      "nextDeadlineOn",
      "nextTripStartsOn",
      "overdue",
      "todayIso",
      "waiting",
    ]);

    // Every value is a number, a date-shaped string, or null — the
    // structural guarantee that no free text can reach a wall tablet.
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "number" || value === null) continue;
      expect(typeof value, key).toBe("string");
      expect(value as string, key).toMatch(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);
    }
  });
});

test.describe("the wall-tablet page", () => {
  test("shows counts, when it was computed, and a way into the app", async ({ page }) => {
    await page.goto("/ha");
    await expect(page.getByRole("heading", { name: "Household at a glance" })).toBeVisible();

    // Every figure is labelled, so nothing on the board depends on colour
    // or position alone.
    for (const label of ["Overdue", "Due today", "Critical", "Waiting on someone", "Events today"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByRole("time")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible();

    // No app chrome: this is meant to be embedded in a dashboard card.
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  });

  test("does not scroll horizontally", async ({ page }) => {
    await page.goto("/ha");
    await expect(page.getByRole("heading", { name: "Household at a glance" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("the wall-tablet page, signed out", () => {
  test.use({ storageState: SIGNED_OUT_STATE });

  // Unlike the endpoint, this one is session-authenticated — so a tablet
  // nobody has signed in on shows a sign-in page, not the household's
  // numbers.
  test("shows nothing to someone with no session", async ({ page }) => {
    await page.goto("/ha");
    await expect(page.getByRole("heading", { name: "Household at a glance" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/login/);
  });
});

// falsegreen-js example - Playwright spec (CommonJS require form).
//
// Regression fixture for Playwright support. A real consumer produced a cluster
// of false positives before the fix; after it, only the one genuine JS31
// remains. What the fix silences here:
//   - test.beforeAll/beforeEach/afterEach/afterAll are lifecycle hooks, not test
//     bodies, so they no longer read as "calls but never asserts" (C2b).
//   - test.describe is a suite wrapper, not a test body.
//   - test.skip(cond, reason) is a runtime conditional skip, not a declared
//     disabled test (no JS4).
//   - a weak presence check that is not the sole oracle no longer fires C6.
// Playwright covers both UI E2E and API tests; both are exercised below and the
// fix applies to either. The scanner reads the syntax tree only; it never runs
// this file.

const { test, expect } = require("@playwright/test");

test.describe("checkout (UI)", () => {
  test.beforeAll(async () => { await seedDatabase(); });
  test.beforeEach(async ({ page }) => { await page.goto("/checkout"); });
  test.afterEach(async ({ page }) => { await page.close(); });

  // Best-effort teardown that swallows any failure so the run still tears down.
  // GENUINE JS31: a throw here vanishes with no assertion on the error. This is
  // the one finding the fixture expects after the fixes.
  test.afterAll(async () => {
    try {
      await dropDatabase();
    } catch (e) {}
  });

  test("shows the cart total", async ({ page, browserName }) => {
    // Runtime conditional skip (a condition, not a title): must not be JS4.
    test.skip(browserName === "webkit", "cart total flaky on webkit");
    await expect(page.locator(".total")).toHaveText("$40.00");
    await expect(page.locator(".checkout-btn")).toBeVisible();
  });

  test("lists the line items", async ({ page }) => {
    const items = page.locator(".line-item");
    await expect(items).toHaveCount(3);
    // A weak presence check ALONGSIDE a strong oracle: not the sole oracle, so
    // the sole-oracle C6 stays quiet.
    expect(items).toBeTruthy();
  });

  test("navigates to payment", async ({ page }) => {
    await page.locator(".checkout-btn").click();
    await expect(page).toHaveURL(/\/payment/);
  });
});

test.describe("orders (API)", () => {
  // API-test hook: sets up state, asserts nothing. Not a test body, so no C2b.
  test.beforeEach(async ({ request }) => { await request.post("/api/reset"); });

  test("GET /api/orders returns ok", async ({ request }) => {
    // Conditional skip in an API test: a runtime guard, not a disabled test.
    test.skip(!process.env.API_URL, "no API base URL configured");
    const res = await request.get("/api/orders");
    await expect(res).toBeOK();
  });

  test("POST /api/orders creates one", async ({ request }) => {
    const res = await request.post("/api/orders", { data: { sku: "abc" } });
    await expect(res).toBeOK();
  });
});

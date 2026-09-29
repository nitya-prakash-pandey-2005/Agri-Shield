import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
  test("loads with brand and a live counter", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Agri-SHIELD/i);
    await expect(page.getByText(/Agri-?SHIELD/i).first()).toBeVisible();
    // Live counters are fed by public.stats — wait for a formatted number to render
    await expect(page.getByText(/farmers? protected/i).first()).toBeVisible();
    await expect(page.locator("text=/\\d{1,3}(,\\d{3})+/").first()).toBeVisible();
  });

  test("public stats API backs the counter", async ({ request }) => {
    const res = await request.get("/api/trpc/public.stats");
    expect(res.ok()).toBeTruthy();
    const stats = (await res.json()).result.data.json;
    expect(stats.districtsMonitored).toBe(22);
    expect(stats.farmersProtectedToday).toBeGreaterThan(0);
  });

  test("health endpoint is up and security headers are sent", async ({ request }) => {
    const res = await request.get("/api/v1/health?deep=0");
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("ok");
    const home = await request.get("/");
    const h = home.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});

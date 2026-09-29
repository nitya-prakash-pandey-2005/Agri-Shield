import { expect, test } from "@playwright/test";
import { DEMO, signIn, trpc } from "./helpers";

test.describe("Government", () => {
  test("officer broadcasts an alert that reaches the district's farmers", async ({ page, browser }) => {
    await signIn(page, DEMO.gov);
    await page.goto("/dashboard/government");
    await expect(page).toHaveURL(/\/dashboard\/government/);

    const title = `E2E drill flood warning ${Date.now()}`;
    const res = await trpc<{ alerts: { id: string; districtId: string }[] }>(
      page.request,
      "government.createAlert",
      {
        alertType: "flood",
        severity: "warning",
        districtIds: ["bd-barisal"],
        title,
        description: "Playwright drill: river rising above danger mark near Barisal.",
        recommendedActions: ["Move livestock to raised ground"],
        channels: ["app", "sms"],
        validHours: 24,
      },
      "mutation"
    );
    expect(res.alerts).toHaveLength(1);

    const ctx = await browser.newContext();
    const farmer = await ctx.newPage();
    await signIn(farmer, DEMO.farmer);
    const alerts = await trpc<unknown>(farmer.request, "farmer.getAlerts", { category: "all", includeArchived: false });
    expect(JSON.stringify(alerts)).toContain(title);
    await ctx.close();
  });

  test("farmers cannot reach the government portal or the admin API", async ({ page }) => {
    await signIn(page, DEMO.farmer);
    await page.goto("/dashboard/government");
    await expect(page).toHaveURL(/\/dashboard\/farmer/);
    const res = await page.request.get("/api/trpc/admin.overview");
    expect(res.status()).toBe(403);
  });
});

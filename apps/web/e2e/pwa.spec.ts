import { expect, test } from "@playwright/test";

test.describe("PWA", () => {
  test("manifest is reachable and installable", async ({ request, page }) => {
    await page.goto("/");
    const href = (await page.locator('link[rel="manifest"]').first().getAttribute("href").catch(() => null)) ?? "/manifest.json";
    const res = await request.get(href);
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.name ?? m.short_name).toMatch(/Agri-?SHIELD/i);
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(m.display);
    expect(m.start_url).toBeTruthy();
    const sizes = (m.icons ?? []).map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  test("service worker script is served", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toMatch(/javascript/);
  });
});

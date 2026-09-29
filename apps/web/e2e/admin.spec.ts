import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

test.describe("Admin", () => {
  test("mission control renders and the SMS bot answers", async ({ page }) => {
    await signIn(page, DEMO.admin);
    await page.goto("/admin");
    await expect(page.getByText(/Mission Control/i).first()).toBeVisible();

    const res = await page.request.post("/api/v1/sms/inbound", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: "From=%2B8801711000000&Body=STATUS",
    });
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(/<Response><Message>[\s\S]*Barisal/);
  });
});

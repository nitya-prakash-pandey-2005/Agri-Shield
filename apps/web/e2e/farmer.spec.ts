import { expect, test } from "@playwright/test";
import { DEMO, signIn, trpc } from "./helpers";

type AnyAlert = { id: string; kind?: string };

test.describe("Farmer", () => {
  test("demo farmer signs in with OTP and lands on the dashboard", async ({ page }) => {
    const user = await signIn(page, DEMO.farmer);
    expect(user.role).toBe("farmer");
    await page.goto("/dashboard/farmer");
    await expect(page).toHaveURL(/\/dashboard\/farmer/);
    await expect(page.getByText(/Ratan/).first()).toBeVisible();
  });

  test("unauthenticated users are redirected to sign-in", async ({ page }) => {
    await page.goto("/dashboard/farmer");
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test("farmer actions an active alert (outcome feedback loop)", async ({ page }) => {
    await signIn(page, DEMO.farmer);
    const res = await trpc<{ active?: AnyAlert[]; alerts?: AnyAlert[] } | AnyAlert[]>(page.request, "farmer.getAlerts", { category: "all", includeArchived: false });
    const list: AnyAlert[] = Array.isArray(res) ? res : res.active ?? res.alerts ?? [];
    const target = list.find((a) => a.kind === "alert" && !(a as { actioned?: boolean }).actioned) ?? list.find((a) => a.kind !== "hazard");
    test.skip(!target, "no active alert for the demo farmer right now");
    await trpc(page.request, "farmer.markAlertActioned", { id: target!.id, kind: target!.kind === "advisory" ? "advisory" : "alert", actions: ["Cleared drainage channels"] }, "mutation");
    const actions = await trpc<unknown[]>(page.request, "farmer.getActions");
    expect(JSON.stringify(actions)).toContain("Cleared drainage channels");
  });

  test("AI advisor answers a question with farm context", async ({ page }) => {
    await signIn(page, DEMO.farmer);
    const answer = await trpc<{ answer: string; actions: unknown[]; provider: string }>(
      page.request,
      "ml.askAdvisor",
      {
        question: "Should I harvest my rice before the rain?",
        language: "en",
        history: [],
        context: { name: "Ratan Das", crops: ["rice", "jute"], area_ha: 3.5, district: "Barisal", country: "Bangladesh", flood_probability: 0.78, salinity_ec: 2.3, forecast_summary: "140 mm in 72 h" },
      },
      "mutation"
    );
    expect(answer.answer.length).toBeGreaterThan(40);
    expect(answer.actions.length).toBeGreaterThan(0);
    await page.goto("/dashboard/farmer");
    await expect(page.getByText(/advisor/i).first()).toBeVisible();
  });
});

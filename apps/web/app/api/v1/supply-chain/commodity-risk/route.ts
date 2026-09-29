/**
 * GET /api/v1/supply-chain/commodity-risk?horizon=7|14|30
 * Commodity disruption risk for ERP / trading integrations (spec §12 "API + webhook access").
 * Auth (required): `X-API-Key: ags_live_…` or `Authorization: Bearer ags_live_…`, scope commodities:read.
 */
import { z } from "zod";
import { computeCommodityRisks } from "@/server/services/supply-chain";
import { API_VERSION, apiError, authorize, json, preflight } from "@/server/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ horizon: z.enum(["7", "14", "30"]).default("7") });

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const auth = authorize(req, { requireKey: true, scope: "commodities:read" });
  if (auth instanceof Response) return auth;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return apiError(400, "invalid_request", "horizon must be 7, 14 or 30", { issues: parsed.error.flatten().fieldErrors });
  try {
    const horizon = Number(parsed.data.horizon) as 7 | 14 | 30;
    const risks = await computeCommodityRisks(horizon);
    return json(
      { ...risks, orgId: auth.apiKey!.orgId, apiVersion: API_VERSION, generatedAt: new Date().toISOString() },
      { requestId: auth.requestId, headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (e) {
    return apiError(502, "upstream_error", `Commodity risk computation failed: ${(e as Error).message}`);
  }
}

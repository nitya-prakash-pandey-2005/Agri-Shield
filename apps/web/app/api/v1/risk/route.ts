/**
 * GET /api/v1/risk?lat=&lon=&type=flood|salinity[&crop=rice]
 * Point risk from the ML service (FastAPI) with the web-formula fallback,
 * enriched with the nearest monitored district's live overlay.
 */
import { z } from "zod";
import type { CropType } from "@agri-shield/types";
import { getStore } from "@/server/data/store";
import { getFloodRisk, getSalinityRisk } from "@/server/ml-client";
import { haversineKm } from "@/server/jobs/climate-scan";
import { API_VERSION, apiError, authorize, json, preflight } from "@/server/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CROPS = ["rice", "wheat", "maize", "sugarcane", "jute", "coconut", "vegetables", "sorghum", "barley", "potato", "onion", "cotton", "tobacco", "banana", "mango"] as const;

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  type: z.enum(["flood", "salinity"]).default("flood"),
  crop: z.enum(CROPS).default("rice"),
});

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const auth = authorize(req, { scope: "risk:read" });
  if (auth instanceof Response) return auth;

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success) return apiError(400, "invalid_request", "Invalid query parameters", { issues: parsed.error.flatten().fieldErrors });
  const { lat, lon, type, crop } = parsed.data;

  const s = getStore();
  let nearest: { d: (typeof s.districts)[number]; km: number } | null = null;
  for (const d of s.districts) {
    const km = haversineKm(lat, lon, d.lat, d.lon);
    if (!nearest || km < nearest.km) nearest = { d, km };
  }
  const inCoverage = !!nearest && nearest.km <= 80;
  const exposure = inCoverage ? (type === "flood" ? nearest!.d.floodExposure : nearest!.d.salinityExposure) : 0.5;

  try {
    const risk = type === "flood" ? await getFloodRisk(lat, lon, exposure) : await getSalinityRisk(lat, lon, crop as CropType, exposure);
    const d = nearest?.d;
    return json(
      {
        type,
        location: { lat, lon },
        risk,
        nearestDistrict: d
          ? {
              id: d.id,
              name: d.name,
              country: d.countryName,
              distanceKm: Math.round(nearest!.km * 10) / 10,
              inCoverage,
              floodRisk: d.floodRisk,
              floodProb72h: d.floodProb72h,
              salinityRisk: d.salinityRisk,
              ecCurrent: d.ecCurrent,
              riskLevel: d.riskLevel,
              liveSource: d.liveSource,
              lastUpdated: d.lastUpdated,
            }
          : null,
        scenario: s.scenario.mode,
        apiVersion: API_VERSION,
        authenticated: !!auth.apiKey,
        generatedAt: new Date().toISOString(),
        attribution: "Weather/flood data: Open-Meteo (CC BY 4.0), Copernicus GloFAS, ECMWF.",
      },
      { requestId: auth.requestId, headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (e) {
    return apiError(502, "upstream_error", `Risk computation failed: ${(e as Error).message}`);
  }
}

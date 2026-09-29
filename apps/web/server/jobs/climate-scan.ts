/**
 * CLIMATE_SCAN (spec §6) — the automated, no-human-in-the-loop alert pipeline.
 *
 *  1. Force-refresh live district risk (Open-Meteo forecast + GloFAS discharge + marine sea level)
 *  2. Pull live hazards (GDACS + NASA EONET) near monitored districts
 *  3. Confirm flood candidates with the ML flood model (FastAPI, or the web formula fallback)
 *  4. For districts/fields above threshold with no same-type alert in the last 6 h → broadcastAlert
 *  5. Generate field-level recommendations for every affected farmer
 *  6. Run severity escalation + supply-chain webhooks
 *  7. Publish `risk.updated` + `scan.completed` to all dashboards
 */
import type { AlertSeverity, AlertType, RecommendationPriority } from "@agri-shield/types";
import { getStore, nextId, HOUR, DAY, type AlertRecord, type DistrictRecord, type FieldRecord } from "../data/store";
import { ensureLiveRiskAwait, invalidateLiveRisk, liveRiskStatus } from "../live/district-risk";
import { getHazardEvents, type HazardEvent } from "../live/events";
import { getFloodRisk } from "../ml-client";
import { publish } from "../realtime";
import { broadcast, runEscalations, runWebhooks } from "./services";
import type { JobResult } from "./registry";

export const FLOOD_P72_THRESHOLD = Number(process.env.FLOOD_ALERT_THRESHOLD ?? 0.6);
export const SALINITY_SCORE_THRESHOLD = Number(process.env.SALINITY_ALERT_THRESHOLD ?? 65);
export const FIELD_FLOOD_THRESHOLD = 75;
export const DEDUPE_WINDOW_MS = 6 * HOUR;
const HAZARD_RADIUS_KM = 150;

const SEV_RANK: Record<AlertSeverity, number> = { watch: 0, warning: 1, emergency: 2 };

export function floodSeverity(p72: number): AlertSeverity {
  return p72 >= 0.85 ? "emergency" : p72 >= 0.72 ? "warning" : "watch";
}

export function salinitySeverity(score: number): AlertSeverity {
  return score >= 92 ? "emergency" : score >= 78 ? "warning" : "watch";
}

/**
 * Dedupe rule: skip if a same-type alert for the district was created in the
 * last 6 h, or an active one of equal/higher severity is still in force
 * (upgrades are handled by the escalation service).
 */
export function isDuplicate(alerts: AlertRecord[], districtId: string, type: AlertType, severity: AlertSeverity, now = Date.now()): boolean {
  return alerts.some(
    (a) =>
      a.districtId === districtId &&
      a.alertType === type &&
      (now - a.createdAt.getTime() < DEDUPE_WINDOW_MS || (a.isActive && a.validUntil.getTime() > now && SEV_RANK[a.severity] >= SEV_RANK[severity]))
  );
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const ACTIONS: Record<AlertType, string[]> = {
  flood: [
    "Harvest mature crops (≥80% maturity) before rainfall peaks",
    "Move seed, fertiliser, equipment and livestock to raised ground",
    "Clear field drainage outlets and open bunds toward canals",
    "Keep phone charged and follow union evacuation notices",
  ],
  salinity: [
    "Close sluice gates at high tide; irrigate only at low tide",
    "Flush affected plots with 150–200 mm freshwater where available",
    "Delay transplanting until EC falls below the crop threshold",
    "Apply gypsum 2–4 t/ha on sodic patches",
  ],
  storm: ["Harvest ready produce before landfall", "Secure roofs, nets and greenhouse covers", "Move boats and equipment to safe shelter"],
  drought: ["Prioritise irrigation for flowering-stage crops", "Mulch to conserve soil moisture", "Switch to alternate wetting and drying (AWD)"],
  frost: ["Irrigate lightly in the evening", "Cover nursery beds overnight"],
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

function maturity(f: FieldRecord, now: number): number {
  const total = f.expectedHarvest.getTime() - f.plantingDate.getTime();
  return total > 0 ? Math.min(1, Math.max(0, (now - f.plantingDate.getTime()) / total)) : 0;
}

/** Field-specific recommendation text for an alert (template engine; the RAG advisor refines on demand). */
export function buildRecommendation(alert: Pick<AlertRecord, "alertType" | "severity" | "id">, field: FieldRecord, district: DistrictRecord, now = Date.now()) {
  const m = maturity(field, now);
  const priority: RecommendationPriority = alert.severity === "emergency" ? "urgent" : alert.severity === "warning" ? "high" : "medium";
  const pct = Math.round(m * 100);
  switch (alert.alertType) {
    case "flood": {
      const harvest = m >= 0.8;
      return {
        recommendationType: "flood_preparedness",
        title: harvest ? `Harvest ${field.name} now — ${pct}% mature, flood risk ${field.floodRisk}%` : `Protect ${field.name}: drain and raise bunds before rainfall`,
        description:
          `72 h flood probability in ${district.name} is ${Math.round(district.floodProb72h * 100)}% with ${district.rainfall72hMm} mm forecast rainfall` +
          (district.riverDischargeM3s ? ` and ${district.riverName} discharge at ${district.riverDischargeM3s} m³/s (30-day mean ${district.riverDischargeMeanM3s ?? "n/a"})` : "") +
          `. Your ${field.cropType} (${field.areaHa} ha, elevation ${field.elevationM} m) is ${pct}% through its cycle.`,
        priority,
        actions: harvest
          ? ["Harvest within 24 h", "Store grain on raised platforms", "Clear drainage outlets"]
          : ["Clear drainage outlets toward the canal", "Raise seedbed bunds by 15 cm", "Move inputs to raised storage"],
        confidenceScore: Math.min(0.95, 0.6 + district.floodProb72h * 0.35),
        expiresAt: new Date(now + 72 * HOUR),
      };
    }
    case "salinity":
      return {
        recommendationType: "salinity_management",
        title: `Salinity rising — protect ${field.cropType} on ${field.name}`,
        description: `Soil EC ${field.soilEc} dS/m now, ${district.ecPredicted30d} dS/m forecast in 30 days for ${district.name}. ${field.cropType} yield loss begins around the crop threshold; act before transplanting/flowering.`,
        priority,
        actions: ["Irrigate at low tide only", "Freshwater flush 150 mm", "Gypsum 2 t/ha on affected patches"],
        confidenceScore: 0.78,
        expiresAt: new Date(now + 14 * DAY),
      };
    case "storm":
      return {
        recommendationType: "storm_preparedness",
        title: `Storm approaching — secure ${field.name}`,
        description: `A tropical system is tracking near ${district.name}. ${m >= 0.8 ? "Your crop is near maturity: harvest early." : "Stake tall crops and secure covers."}`,
        priority,
        actions: m >= 0.8 ? ["Harvest early", "Secure stored grain"] : ["Secure covers and nets", "Clear drainage"],
        confidenceScore: 0.7,
        expiresAt: new Date(now + 72 * HOUR),
      };
    default:
      return {
        recommendationType: `${alert.alertType}_response`,
        title: `${alert.alertType} advisory for ${field.name}`,
        description: `Conditions in ${district.name} call for precautionary action on your ${field.cropType}.`,
        priority,
        actions: ACTIONS[alert.alertType].slice(0, 2),
        confidenceScore: 0.65,
        expiresAt: new Date(now + 5 * DAY),
      };
  }
}

interface Candidate {
  district: DistrictRecord;
  type: AlertType;
  severity: AlertSeverity;
  source: AlertRecord["source"];
  title: string;
  description: string;
  validHours: number;
  reason: string;
}

export async function climateScan(opts: { triggeredBy?: string } = {}): Promise<JobResult> {
  const t0 = Date.now();
  const store = getStore();

  // 1. Live risk
  invalidateLiveRisk();
  await ensureLiveRiskAwait(25_000);
  const live = store.districts.filter((d) => d.liveSource === "open-meteo").length;

  // 2. Hazards
  const hazards: HazardEvent[] = await withTimeout(getHazardEvents(), 15_000).then((h) => h ?? []);
  const recentHazards = hazards.filter((h) => Date.now() - new Date(h.date).getTime() < 72 * HOUR);

  const candidates: Candidate[] = [];
  const mlVersions = new Set<string>();
  let mlConfirmations = 0;

  // 3. Flood candidates, confirmed by the ML flood model (ensemble-max for recall)
  const floodPre = store.districts.filter((d) => d.floodProb72h >= FLOOD_P72_THRESHOLD - 0.1);
  const mlResults = await Promise.all(floodPre.map((d) => withTimeout(getFloodRisk(d.lat, d.lon, d.floodExposure), 12_000)));
  floodPre.forEach((d, i) => {
    const ml = mlResults[i];
    if (ml) {
      mlConfirmations++;
      mlVersions.add(`${ml.model_version} (${ml.source})`);
    }
    const p72 = Math.max(d.floodProb72h, ml?.probability_72h ?? 0);
    if (p72 < FLOOD_P72_THRESHOLD) return;
    const severity = floodSeverity(p72);
    candidates.push({
      district: d,
      type: "flood",
      severity,
      source: "model",
      title: `${severity === "emergency" ? "Flood Emergency" : severity === "warning" ? "Flood Warning" : "Flood Watch"} — ${d.name}`,
      description:
        `Automated climate scan: 72 h flood probability ${Math.round(p72 * 100)}% (24 h ${Math.round(d.floodProb24h * 100)}%). ` +
        `Forecast rainfall ${d.rainfall72hMm} mm over 72 h` +
        (d.riverDischargeM3s ? `; ${d.riverName} discharge ${d.riverDischargeM3s} m³/s vs 30-day mean ${d.riverDischargeMeanM3s}` : "") +
        `. ${ml ? `Confirmed by ${ml.model_version}` : "District ensemble score"}; factors: ${(ml?.contributing_factors ?? ["live_forecast"]).join(", ")}.`,
      validHours: 72,
      reason: `p72=${p72.toFixed(2)}`,
    });
  });

  // Salinity candidates
  for (const d of store.districts) {
    if (d.salinityRisk < SALINITY_SCORE_THRESHOLD) continue;
    const severity = salinitySeverity(d.salinityRisk);
    candidates.push({
      district: d,
      type: "salinity",
      severity,
      source: "model",
      title: `Saltwater Intrusion ${severity === "emergency" ? "Emergency" : severity === "warning" ? "Warning" : "Watch"} — ${d.name}`,
      description:
        `Automated climate scan: EC ${d.ecCurrent} dS/m now, ${d.ecPredicted30d} dS/m forecast in 30 days on the ${d.riverName}` +
        (d.seaLevelAnomalyM != null ? `; peak sea level ${d.seaLevelAnomalyM} m above MSL (Open-Meteo Marine)` : "") +
        `. Rice yield loss is likely above 3 dS/m.`,
      validHours: 168,
      reason: `salinity=${d.salinityRisk}`,
    });
  }

  // Field-level: hot-spot fields in districts that did not trigger a flood alert
  const floodDistricts = new Set(candidates.filter((c) => c.type === "flood").map((c) => c.district.id));
  const farmerDistrict = new Map(store.farmers.map((f) => [f.id, f.districtId]));
  const hotFields = new Map<string, FieldRecord[]>();
  for (const f of store.fields) {
    if (f.floodRisk < FIELD_FLOOD_THRESHOLD) continue;
    const did = farmerDistrict.get(f.farmerId);
    if (!did || floodDistricts.has(did)) continue;
    hotFields.set(did, [...(hotFields.get(did) ?? []), f]);
  }
  for (const [did, fields] of hotFields) {
    const d = store.districts.find((x) => x.id === did)!;
    candidates.push({
      district: d,
      type: "flood",
      severity: "watch",
      source: "model",
      title: `Localised Flood Watch — ${d.name}`,
      description: `${fields.length} monitored field(s) exceed ${FIELD_FLOOD_THRESHOLD}% flood risk (low elevation / drainage) although the district average is ${d.floodRisk}%.`,
      validHours: 48,
      reason: `${fields.length} hot fields`,
    });
  }

  // Hazard proximity (GDACS orange/red, EONET floods/storms within 150 km, last 72 h)
  for (const h of recentHazards) {
    if (h.source === "GDACS" && h.alertLevel !== "orange" && h.alertLevel !== "red") continue;
    const type: AlertType = h.type === "flood" ? "flood" : h.type === "drought" ? "drought" : "storm";
    for (const d of store.districts) {
      const km = haversineKm(d.lat, d.lon, h.lat, h.lon);
      if (km > HAZARD_RADIUS_KM) continue;
      const severity: AlertSeverity = h.alertLevel === "red" ? "emergency" : h.alertLevel === "orange" ? "warning" : "watch";
      candidates.push({
        district: d,
        type,
        severity,
        source: h.source === "GDACS" ? "gdacs" : "eonet",
        title: `${h.source}: ${h.title} — ${d.name}`,
        description: `${h.source} reports "${h.title}" ${Math.round(km)} km from ${d.name} (${new Date(h.date).toUTCString()}).`,
        validHours: 72,
        reason: `${h.source} ${Math.round(km)} km`,
      });
    }
  }

  // 4 + 5. Broadcast (deduped) and generate recommendations
  const created: { id: string; district: string; type: AlertType; severity: AlertSeverity; source: string; reason: string }[] = [];
  const skipped: string[] = [];
  let recommendationsCreated = 0;
  let via = "service";
  const seen = new Set<string>();
  for (const c of candidates.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])) {
    const key = `${c.district.id}:${c.type}`;
    if (seen.has(key) || isDuplicate(store.alerts, c.district.id, c.type, c.severity)) {
      skipped.push(`${key}:${c.severity}`);
      continue;
    }
    seen.add(key);
    try {
      const r = await broadcast({
        alertType: c.type,
        severity: c.severity,
        districtIds: [c.district.id],
        title: c.title,
        description: c.description,
        recommendedActions: ACTIONS[c.type].slice(0, 3),
        channels: c.severity === "watch" ? ["app", "sms"] : ["app", "sms", "whatsapp"],
        createdBy: opts.triggeredBy ?? "system",
        source: c.source,
        validHours: c.validHours,
      });
      via = r.via;
      for (const alert of r.alerts) {
        created.push({ id: alert.id, district: c.district.name, type: c.type, severity: c.severity, source: c.source, reason: c.reason });
        recommendationsCreated += generateRecommendations(alert, c.district);
      }
    } catch (e) {
      skipped.push(`${key}:error:${(e as Error).message}`);
    }
  }

  // 6. Escalations + webhooks
  const [escalations, webhooks] = await Promise.all([runEscalations().catch((e) => `error: ${e.message}`), runWebhooks().catch((e) => `error: ${e.message}`)]);

  // 7. Realtime
  const at = new Date().toISOString();
  publish("global", { type: "risk.updated", districtIds: store.districts.map((d) => d.id), at });
  publish("global", { type: "scan.completed", alertsCreated: created.length, at });

  const top = [...store.districts].sort((a, b) => b.floodRisk - a.floodRisk).slice(0, 3);
  return {
    status: live === 0 ? "partial" : "success",
    summary:
      `${store.districts.length} districts scanned (${live} live), ${recentHazards.length} recent hazards, ${created.length} alert(s) raised, ` +
      `${recommendationsCreated} recommendation(s), ${skipped.length} deduped; top flood: ${top.map((d) => `${d.name} ${d.floodRisk}%`).join(", ")}`,
    output: {
      districtsScanned: store.districts.length,
      liveDistricts: live,
      scenario: store.scenario.mode,
      liveRisk: liveRiskStatus(),
      hazardsConsidered: recentHazards.length,
      mlConfirmations,
      mlModels: [...mlVersions],
      alertsCreated: created,
      deduped: skipped.length,
      recommendationsCreated,
      broadcastVia: via,
      escalations,
      webhooks,
      tookMs: Date.now() - t0,
    },
  };
}

/** Create one recommendation per affected field for an alert (idempotent per field+alert). */
export function generateRecommendations(alert: AlertRecord, district: DistrictRecord): number {
  const store = getStore();
  const farmerIds = new Set(store.farmers.filter((f) => f.districtId === district.id).map((f) => f.id));
  let n = 0;
  for (const field of store.fields) {
    if (!farmerIds.has(field.farmerId)) continue;
    if (store.recommendations.some((r) => r.fieldId === field.id && r.alertId === alert.id)) continue;
    const rec = buildRecommendation(alert, field, district);
    store.recommendations.unshift({
      id: nextId("rec"),
      fieldId: field.id,
      alertId: alert.id,
      recommendationType: rec.recommendationType,
      title: rec.title,
      description: rec.description,
      priority: rec.priority,
      actions: rec.actions,
      confidenceScore: Math.round(rec.confidenceScore * 100) / 100,
      generatedBy: "climate-scan/recommender-v1",
      createdAt: new Date(),
      expiresAt: rec.expiresAt,
    });
    n++;
  }
  if (store.recommendations.length > 5000) store.recommendations.length = 5000;
  return n;
}

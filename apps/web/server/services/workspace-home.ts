/**
 * Workspace Home data: per-asset live scores, industry-aware KPI tiles, the
 * plain-language risk briefing, mini-map points, hazards near assets.
 * Shared by the Home screen and the Reports hub so both tell the same story.
 */
import type { Industry, RiskLevel } from "@agri-shield/types";
import { getStore, riskLevelFromScore, type AssetRecord, type OrgRecord } from "../data/store";
import { cached } from "../live/http";
import { getHazardEvents, type HazardEvent } from "../live/events";
import { assessMany, haversineKm, type QuickAssessment } from "./location-risk";

export interface AssetScore {
  composite: number;
  flood: number;
  salinity: number;
  drought: number;
  heat: number;
  level: RiskLevel;
  rain72hMm: number | null;
  salinityEc: number | null;
  drivers: string[];
  source: "portfolio re-score" | "open-meteo" | "fallback";
  at: Date;
}

const FRESH_MS = 6 * 3_600_000;

/**
 * Live scores for every active asset in the workspace. Uses the Portfolio
 * module's stored assessment when fresh (< 6 h), otherwise a batched
 * Open-Meteo/GloFAS assessment (cached 15 min per workspace).
 */
export async function portfolioScores(orgId: string): Promise<Map<string, AssetScore>> {
  const assets = getStore().assets.filter((a) => a.workspaceId === orgId && a.status === "active");
  const out = new Map<string, AssetScore>();
  const stale: AssetRecord[] = [];
  for (const a of assets) {
    const la = a.lastAssessment;
    if (la && Date.now() - new Date(la.at).getTime() < FRESH_MS) {
      out.set(a.id, { composite: la.composite, flood: la.floodRisk, salinity: la.salinityRisk, drought: la.droughtRisk, heat: la.heatRisk, level: la.level, rain72hMm: null, salinityEc: null, drivers: la.drivers, source: "portfolio re-score", at: new Date(la.at) });
    } else stale.push(a);
  }
  if (stale.length) {
    const key = `ws-scores:${orgId}:${stale.length}:${stale[0]!.id}`;
    const scored = await cached(key, 15 * 60_000, async () => {
      const m = await assessMany(stale.map((a) => ({ id: a.id, lat: a.lat, lon: a.lon, crop: a.crop })));
      return { at: new Date(), rows: [...m.entries()] };
    }).catch(() => ({ at: new Date(), rows: [] as [string, QuickAssessment][] }));
    for (const [id, q] of scored.rows) {
      out.set(id, { composite: q.composite, flood: q.floodRisk, salinity: q.salinityRisk, drought: q.droughtRisk, heat: q.heatRisk, level: q.level, rain72hMm: q.rain72hMm, salinityEc: q.salinityEc, drivers: q.drivers, source: q.source, at: scored.at });
    }
    // Last resort (feed down, nothing cached): the asset's own 30-day history
    for (const a of stale) {
      if (out.has(a.id)) continue;
      const last = a.history[a.history.length - 1]?.composite ?? 30;
      out.set(a.id, { composite: last, flood: last, salinity: 0, drought: 0, heat: 0, level: riskLevelFromScore(last), rain72hMm: null, salinityEc: null, drivers: ["Last stored score (live feeds unavailable)"], source: "fallback", at: new Date() });
    }
  }
  return out;
}

// ─── Industry vocabulary ──────────────────────────────────────────────────

export const INDUSTRY_NOUN: Record<Industry, { one: string; many: string; value: string }> = {
  insurance: { one: "insured unit", many: "insured units", value: "sum insured" },
  banking: { one: "agri loan", many: "agri loans", value: "outstanding balance" },
  ngo: { one: "community", many: "communities", value: "cash-transfer envelope" },
  cooperative: { one: "member farm", many: "member farms", value: "crop value" },
  agribusiness: { one: "facility", many: "facilities", value: "asset & stock value" },
  government: { one: "asset", many: "assets", value: "asset value" },
};

export const INDUSTRY_LABEL: Record<Industry, string> = {
  insurance: "Insurance",
  banking: "Banking & MFI",
  ngo: "NGO / humanitarian",
  cooperative: "Farmer co-operative",
  agribusiness: "Agribusiness & food",
  government: "Government",
};

export function industryOf(org: OrgRecord): Industry {
  return org.industry ?? (org.type === "government" ? "government" : org.type === "ngo" ? "ngo" : org.type === "insurance" ? "insurance" : org.type === "bank" ? "banking" : org.type === "cooperative" ? "cooperative" : "agribusiness");
}

export const QUICK_ACTIONS: Record<Industry, { label: string; description: string; href: string; icon: string }[]> = {
  insurance: [
    { label: "Parametric trigger check", description: "Which policies are near payout", href: "/app/insurance", icon: "shield" },
    { label: "Underwrite a new location", description: "Full risk report for any coordinate", href: "/app/explorer", icon: "compass" },
    { label: "Accumulation map", description: "Where exposure is concentrated", href: "/app/portfolio", icon: "layers" },
    { label: "Board pack PDF", description: "Exec summary of the book", href: "/app/reports?type=board_pack", icon: "file" },
  ],
  banking: [
    { label: "Climate-adjusted PD", description: "Stress the loan book", href: "/app/finance", icon: "landmark" },
    { label: "Due diligence on a borrower", description: "Location report for a new loan", href: "/app/explorer", icon: "compass" },
    { label: "Physical-risk disclosure", description: "TCFD / ISSB S2 report", href: "/app/reports?type=physical_risk", icon: "file" },
    { label: "Set a salinity rule", description: "Warn credit officers early", href: "/app/alerts", icon: "bell" },
  ],
  ngo: [
    { label: "Anticipatory triggers", description: "Release cash before the flood", href: "/app/anticipatory", icon: "hand" },
    { label: "Communities at risk", description: "Households in the path", href: "/app/portfolio", icon: "layers" },
    { label: "Weekly digest", description: "Donor-ready summary", href: "/app/reports?type=weekly_digest", icon: "file" },
    { label: "Ask the Copilot", description: "Plain-language answers", href: "/app/copilot", icon: "bot" },
  ],
  cooperative: [
    { label: "Member farm risk", description: "Who needs help this week", href: "/app/portfolio", icon: "layers" },
    { label: "Alert members", description: "Rules that notify farmers", href: "/app/alerts", icon: "bell" },
    { label: "Check a field", description: "Risk for any location", href: "/app/explorer", icon: "compass" },
    { label: "Ask the Copilot", description: "Agronomy advice", href: "/app/copilot", icon: "bot" },
  ],
  agribusiness: [
    { label: "Facility exposure", description: "Warehouses & plants at risk", href: "/app/portfolio", icon: "layers" },
    { label: "Sourcing region check", description: "Risk for a supplier location", href: "/app/explorer", icon: "compass" },
    { label: "Disruption alerts", description: "Rules on your network", href: "/app/alerts", icon: "bell" },
    { label: "Board pack PDF", description: "Exec summary", href: "/app/reports?type=board_pack", icon: "file" },
  ],
  government: [
    { label: "Command centre", description: "National early-warning view", href: "/dashboard/government", icon: "radar" },
    { label: "Risk explorer", description: "Any district or coordinate", href: "/app/explorer", icon: "compass" },
    { label: "Anticipatory action", description: "Pre-arranged response", href: "/app/anticipatory", icon: "hand" },
    { label: "Weekly digest", description: "Minister's brief", href: "/app/reports?type=weekly_digest", icon: "file" },
  ],
};

// ─── Formatting ───────────────────────────────────────────────────────────

export function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export function greeting(timezone: string, now = new Date()): string {
  let h = now.getUTCHours();
  try {
    h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  } catch {}
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const topKey = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

// ─── Metrics + briefing ───────────────────────────────────────────────────

export interface PortfolioMetrics {
  industry: Industry;
  noun: { one: string; many: string; value: string };
  threshold: number;
  total: number;
  exposureUsd: number;
  atRisk: number;
  atRiskPct: number;
  atRiskExposureUsd: number;
  highFlood: number;
  highSalinity: number;
  highDrought: number;
  highHeat: number;
  topFloodDistrict: string | null;
  topSalinityDistrict: string | null;
  topAtRiskDistrict: string | null;
  avgComposite: number;
  avgComposite7dAgo: number | null;
  levels: Record<RiskLevel, number>;
  activeAlerts: number;
  nearTrigger: number;
  sourceMix: Record<string, number>;
  byDistrict: { district: string; country: string; assets: number; atRisk: number; exposureUsd: number; avgComposite: number }[];
  top: { id: string; name: string; ref: string | null; district: string | null; composite: number; level: RiskLevel; flood: number; salinity: number; valueUsd: number; driver: string }[];
}

export function computeMetrics(org: OrgRecord, assets: AssetRecord[], scores: Map<string, AssetScore>): PortfolioMetrics {
  const s = getStore();
  const industry = industryOf(org);
  const threshold = org.settings?.riskThreshold ?? 60;
  const dName = (id: string | null) => (id ? (s.districts.find((d) => d.id === id)?.name ?? null) : null);
  const floodBy = new Map<string, number>();
  const salBy = new Map<string, number>();
  const riskBy = new Map<string, number>();
  const levels: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const district = new Map<string, { district: string; country: string; assets: number; atRisk: number; exposureUsd: number; sum: number }>();
  let exposure = 0, atRisk = 0, atRiskExp = 0, hf = 0, hs = 0, hd = 0, hh = 0, sum = 0, sum7 = 0, n7 = 0, nearTrigger = 0;
  const sourceMix: Record<string, number> = {};
  for (const a of assets) {
    const sc = scores.get(a.id);
    if (!sc) continue;
    exposure += a.valueUsd;
    sum += sc.composite;
    levels[sc.level] += 1;
    sourceMix[sc.source] = (sourceMix[sc.source] ?? 0) + 1;
    const dn = dName(a.districtId) ?? a.country;
    const row = district.get(dn) ?? { district: dn, country: a.country, assets: 0, atRisk: 0, exposureUsd: 0, sum: 0 };
    row.assets += 1;
    row.exposureUsd += a.valueUsd;
    row.sum += sc.composite;
    if (sc.composite >= threshold) {
      atRisk += 1;
      atRiskExp += a.valueUsd;
      row.atRisk += 1;
      riskBy.set(dn, (riskBy.get(dn) ?? 0) + 1);
    }
    district.set(dn, row);
    if (sc.flood >= 60) (hf += 1), floodBy.set(dn, (floodBy.get(dn) ?? 0) + 1);
    if (sc.salinity >= 60) (hs += 1), salBy.set(dn, (salBy.get(dn) ?? 0) + 1);
    if (sc.drought >= 60) hd += 1;
    if (sc.heat >= 60) hh += 1;
    if (sc.rain72hMm !== null && sc.rain72hMm >= 120 && a.tags.includes("parametric")) nearTrigger += 1;
    const h7 = a.history[a.history.length - 8];
    if (h7) (sum7 += h7.composite), (n7 += 1);
  }
  const n = scores.size || 1;
  const districtIds = new Set(assets.map((a) => a.districtId).filter(Boolean));
  const activeAlerts = s.alerts.filter((al) => al.isActive && districtIds.has(al.districtId)).length;
  const top = assets
    .map((a) => ({ a, sc: scores.get(a.id)! }))
    .filter((x) => x.sc)
    .sort((x, y) => y.sc.composite - x.sc.composite)
    .slice(0, 10)
    .map(({ a, sc }) => ({ id: a.id, name: a.name, ref: a.externalRef, district: dName(a.districtId), composite: Math.round(sc.composite), level: sc.level, flood: Math.round(sc.flood), salinity: Math.round(sc.salinity), valueUsd: a.valueUsd, driver: sc.drivers[0] ?? "—" }));
  return {
    industry,
    noun: INDUSTRY_NOUN[industry],
    threshold,
    total: assets.length,
    exposureUsd: exposure,
    atRisk,
    atRiskPct: assets.length ? Math.round((atRisk / assets.length) * 1000) / 10 : 0,
    atRiskExposureUsd: atRiskExp,
    highFlood: hf,
    highSalinity: hs,
    highDrought: hd,
    highHeat: hh,
    topFloodDistrict: topKey(floodBy),
    topSalinityDistrict: topKey(salBy),
    topAtRiskDistrict: topKey(riskBy),
    avgComposite: Math.round((sum / n) * 10) / 10,
    avgComposite7dAgo: n7 ? Math.round((sum7 / n7) * 10) / 10 : null,
    levels,
    activeAlerts,
    nearTrigger,
    sourceMix,
    byDistrict: [...district.values()].map((r) => ({ district: r.district, country: r.country, assets: r.assets, atRisk: r.atRisk, exposureUsd: r.exposureUsd, avgComposite: Math.round(r.sum / Math.max(1, r.assets)) })).sort((a, b) => b.atRisk - a.atRisk || b.exposureUsd - a.exposureUsd),
    top,
  };
}

/** Plain-language sentences for the "today's risk briefing" card. */
export function buildBriefing(m: PortfolioMetrics, nearbyHazards: number): { headline: string; lines: { tone: "critical" | "warning" | "ok" | "info"; text: string }[] } {
  const N = m.total;
  const many = m.noun.many;
  const one = m.noun.one;
  const nounFor = (k: number) => (k === 1 ? one : many);
  if (!N) {
    return {
      headline: "Add your first asset to get a daily risk briefing.",
      lines: [{ tone: "info", text: "Once you add locations (plots, loans, farms, sites), we check them every day against flood, salinity, drought and heat forecasts and summarise it here." }],
    };
  }
  const lines: { tone: "critical" | "warning" | "ok" | "info"; text: string }[] = [];
  const headline =
    m.highFlood > 0
      ? `${m.highFlood} of your ${N} ${many} face high flood risk in the next 72 hours${m.topFloodDistrict ? ` — mostly in ${m.topFloodDistrict}` : ""}.`
      : m.atRisk > 0
        ? `${m.atRisk} of your ${N} ${many} are above your risk threshold today${m.topAtRiskDistrict ? ` — mostly in ${m.topAtRiskDistrict}` : ""}.`
        : `All ${N} of your ${many} are below your risk threshold today. No high flood risk in the next 72 hours.`;
  if (m.highSalinity > 0) lines.push({ tone: "warning", text: `${m.highSalinity} ${nounFor(m.highSalinity)} show high salinity risk — salt water is likely to reach levels that cut yields${m.topSalinityDistrict ? `, especially around ${m.topSalinityDistrict}` : ""}.` });
  if (m.highDrought > 0) lines.push({ tone: "warning", text: `${m.highDrought} ${nounFor(m.highDrought)} are drier than normal with little rain forecast (high drought risk).` });
  if (m.highHeat > 0) lines.push({ tone: "warning", text: `${m.highHeat} ${nounFor(m.highHeat)} face damaging heat in the coming days.` });
  if (m.nearTrigger > 0) lines.push({ tone: "critical", text: `${m.nearTrigger} parametric ${m.nearTrigger === 1 ? "policy is" : "policies are"} forecast at or above 120 mm of rain in 72 h — close to the 150 mm payout trigger.` });
  lines.push({
    tone: m.atRisk > 0 ? "warning" : "ok",
    text: `${m.atRisk} ${nounFor(m.atRisk)} (${m.atRiskPct}%) score above your threshold of ${m.threshold}/100, carrying ${fmtUsd(m.atRiskExposureUsd)} of ${fmtUsd(m.exposureUsd)} ${m.noun.value}.`,
  });
  if (m.avgComposite7dAgo !== null) {
    const d = Math.round((m.avgComposite - m.avgComposite7dAgo) * 10) / 10;
    lines.push({ tone: d > 3 ? "warning" : "info", text: Math.abs(d) < 1 ? `Average risk is about the same as a week ago (${m.avgComposite}/100).` : `Average risk is ${d > 0 ? "up" : "down"} ${Math.abs(d)} points on a week ago (now ${m.avgComposite}/100).` });
  }
  if (m.activeAlerts > 0) lines.push({ tone: "critical", text: `${m.activeAlerts} active official hazard ${m.activeAlerts === 1 ? "alert covers a district" : "alerts cover districts"} where you have ${many}.` });
  if (nearbyHazards > 0) lines.push({ tone: "info", text: `${nearbyHazards} live disaster ${nearbyHazards === 1 ? "event" : "events"} (GDACS / NASA) within 300 km of your ${many}.` });
  return { headline, lines };
}

export function kpiTiles(m: PortfolioMetrics, assets: AssetRecord[], scores: Map<string, AssetScore>) {
  const at = (a: AssetRecord) => (scores.get(a.id)?.composite ?? 0) >= m.threshold;
  const sumMeta = (k: string, pred: (a: AssetRecord) => boolean = () => true) => assets.filter(pred).reduce((n, a) => n + (Number(a.meta[k]) || 0), 0);
  const base = [
    { key: "assets", label: m.noun.many.replace(/^./, (c) => c.toUpperCase()), value: m.total, format: "int" as const, hint: `Active ${m.noun.many} monitored in this workspace`, term: "asset" },
    { key: "exposure", label: `Total ${m.noun.value}`, value: m.exposureUsd, format: "usd" as const, hint: "Sum of the value you have at stake across all assets", term: "exposure" },
    { key: "atRisk", label: "At risk", value: m.atRiskPct, format: "pct" as const, hint: `${m.atRisk} ${m.noun.many} score ≥ ${m.threshold}/100`, term: "risk_threshold" },
    { key: "alerts", label: "Active alerts", value: m.activeAlerts, format: "int" as const, hint: "Official hazard alerts in districts where you have assets", term: "gdacs" },
  ];
  const extra = (() => {
    switch (m.industry) {
      case "insurance":
        return { key: "trigger", label: "Near payout trigger", value: m.nearTrigger, format: "int" as const, hint: "Parametric policies forecast ≥ 120 mm / 72 h (trigger 150 mm)", term: "trigger" };
      case "banking":
        return { key: "dpd", label: "Loans > 30 DPD", value: assets.filter((a) => Number(a.meta.daysPastDue) > 30).length, format: "int" as const, hint: "Loans more than 30 days past due", term: "dpd" };
      case "ngo":
        return { key: "households", label: "Households at risk", value: sumMeta("households", at), format: "int" as const, hint: "Households in communities above your threshold", term: "anticipatory_action" };
      case "cooperative":
        return { key: "hectares", label: "Hectares at risk", value: Math.round(assets.filter(at).reduce((n, a) => n + (a.areaHa ?? 0), 0) * 10) / 10, format: "ha" as const, hint: "Member farm area above your threshold", term: "composite_score" };
      case "agribusiness":
        return { key: "capacity", label: "Capacity at risk", value: sumMeta("capacityTonnes", at), format: "t" as const, hint: "Storage/processing capacity (tonnes) at facilities above threshold", term: "composite_score" };
      default:
        return { key: "atRiskExposure", label: "Exposure at risk", value: m.atRiskExposureUsd, format: "usd" as const, hint: "Value at assets above your threshold", term: "exposure" };
    }
  })();
  return [...base.slice(0, 3), extra, base[3]!];
}

export async function hazardsNear(assets: AssetRecord[], radiusKm = 300) {
  const events: HazardEvent[] = await getHazardEvents().catch(() => []);
  return events
    .map((e) => {
      let min = Infinity;
      let within = 0;
      for (const a of assets) {
        const d = haversineKm(e.lat, e.lon, a.lat, a.lon);
        if (d < min) min = d;
        if (d <= radiusKm) within += 1;
      }
      return { ...e, distanceKm: Math.round(min), assetsWithin: within };
    })
    .filter((e) => e.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8);
}

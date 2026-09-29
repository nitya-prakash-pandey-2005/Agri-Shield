/**
 * Copilot tools — TypeScript functions over the platform's own data, always
 * scoped to the caller's workspace (ctx.orgId). Each returns compact facts
 * (`data`, for LLM planners), a deterministic markdown answer built only from
 * those facts, and UI artifacts (tables, maps, charts, KPI cards).
 */
import { incidentsTool, sensorsTool, twinBriefingTool, yieldOutlookTool } from "./tools-ext";
import { getStore } from "../../data/store";
import { getForecast, weatherLabel } from "../../live/open-meteo";
import { getHazardEvents } from "../../live/events";
import { assessLocation, haversineKm, type LocationRiskReport } from "../location-risk";
import { describeRule } from "../rules";
import { trackUsage } from "../usage";
import { GLOSSARY } from "./glossary";
import {
  LINKS,
  applyFilter,
  cap,
  describeFilter,
  findAssets,
  loadWorkspace,
  nounFor,
  num,
  pct,
  plural,
  resolvePlace,
  usd,
  type ResolvedPlace,
  type Row,
  type RowFilter,
  type Workspace,
} from "./data";
import type { Threshold } from "./intent";
import type { Artifact, CopilotAction, CopilotContext, Hazard, MapMarker, ToolName, ToolOutput } from "./types";

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const nbr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : typeof v === "string" && v ? [v] : undefined);

const HAZARD_LABEL: Record<Hazard, string> = { flood: "flood risk", salinity: "salinity risk", drought: "drought risk", heat: "heat risk", composite: "composite score" };
const HAZARD_KEY: Record<Hazard, keyof Pick<Row, "flood" | "salinity" | "drought" | "heat" | "composite">> = { flood: "flood", salinity: "salinity", drought: "drought", heat: "heat", composite: "composite" };
const RULE_FOR: Record<Hazard, { metric: string; value: number }> = {
  flood: { metric: "flood_prob_72h", value: 60 },
  salinity: { metric: "salinity_ec", value: 4 },
  drought: { metric: "drought_risk", value: 50 },
  heat: { metric: "heat_risk", value: 50 },
  composite: { metric: "composite", value: 60 },
};
const asHazard = (v: unknown): Hazard => (["flood", "salinity", "drought", "heat", "composite"].includes(String(v)) ? (v as Hazard) : "composite");

const SRC_STORE = "Agri-SHIELD workspace portfolio";
const SRC_LIVE = "Open-Meteo forecast + GloFAS v4 river discharge (live)";

function wsSource(ws: Workspace) {
  return [SRC_STORE, ws.kind === "districts" ? "District risk overlay (Open-Meteo live)" : ws.live ? SRC_LIVE : "Stored assessments / district baseline"];
}

function markers(rows: Row[], max = 60): MapMarker[] {
  return rows.slice(0, max).map((r) => ({ lat: r.lat, lon: r.lon, label: r.name, score: r.composite, href: r.href, kind: "asset" as const }));
}

function empty(msg: string, extra: Partial<ToolOutput> = {}): ToolOutput {
  return { data: { error: msg }, markdown: msg, artifacts: [], actions: [], sources: [SRC_STORE], notFound: msg, ...extra };
}

const valueLabel = (ws: Workspace, rows: Row[]) => {
  const t = rows[0]?.type;
  return t === "insured_plot" ? "sum insured" : t === "loan" ? "loan outstanding" : t === "community" ? "cash-transfer envelope" : t === "farm" ? "crop value" : ws.kind === "districts" ? "value" : "replacement / stock value";
};

// ─── 1. Portfolio summary ────────────────────────────────────────────────

async function portfolioSummary(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  const f: RowFilter = { country: str(args.country), types: strArr(args.types), crop: str(args.crop), tag: str(args.tag), area: str(args.area) };
  const rows = applyFilter(ws.rows, f);
  const scope = describeFilter(f);
  if (!ws.rows.length) return empty(`Your workspace has no monitored assets yet. Import a CSV/GeoJSON in Portfolio to get started.`, { actions: [{ label: "Import assets", href: LINKS.portfolio(), kind: "portfolio" }] });
  if (!rows.length) return empty(`No ${nounFor(ws.rows, 2)} match ${scope || "that filter"} in ${ws.orgName}.`);

  const n = rows.length;
  const noun = nounFor(rows, n);
  const atRisk = rows.filter((r) => r.composite >= ws.riskThreshold);
  const total = rows.reduce((t, r) => t + r.valueUsd, 0);
  const var_ = atRisk.reduce((t, r) => t + r.valueUsd, 0);
  const varModel = rows.reduce((t, r) => t + r.varUsd, 0);
  const avg = rows.reduce((t, r) => t + r.composite, 0) / n;
  const levels = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const r of rows) levels[r.level] = (levels[r.level] ?? 0) + 1;
  const hz = (["flood", "salinity", "drought", "heat"] as const).map((h) => ({ h, count: rows.filter((r) => r[h] >= 60).length, avg: rows.reduce((t, r) => t + r[h], 0) / n }));
  const dominant = [...hz].sort((a, b) => b.avg - a.avg)[0]!;
  const driverCount = new Map<string, number>();
  for (const r of atRisk) for (const d of r.drivers) driverCount.set(d.replace(/\s*\(.*\)$/, ""), (driverCount.get(d.replace(/\s*\(.*\)$/, "")) ?? 0) + 1);
  const topDrivers = [...driverCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const sorted = [...rows].sort((a, b) => b.composite - a.composite);

  // 30-day trend from stored daily composites
  const byDate = new Map<string, number[]>();
  for (const r of rows) for (const h of r.history) (byDate.get(h.date) ?? byDate.set(h.date, []).get(h.date)!).push(h.composite);
  const trend = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([x, v]) => ({ x, y: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 }));
  const trendStart = trend[0]?.y;

  const countries = new Map<string, Row[]>();
  for (const r of rows) (countries.get(r.country) ?? countries.set(r.country, []).get(r.country)!).push(r);

  const vl = valueLabel(ws, rows);
  const lines = [
    `**${ws.orgName}** monitors **${plural(n, noun, noun)}**${scope ? ` ${scope}` : ""}${ws.kind === "assets" ? ` with a total ${vl} of **${usd(total)}**` : ""}.`,
    `- **${num(atRisk.length)} (${pct(atRisk.length, n)})** are at or above your at-risk threshold of **${ws.riskThreshold}/100**${ws.kind === "assets" ? `, carrying **${usd(var_)}** of ${vl} (${pct(var_, total)} of the total) — “exposure at risk”` : ""}.`,
    ...(ws.kind === "assets" ? [`- Modelled value-at-risk (expected-loss style, Portfolio formula): **${usd(varModel)}** (${pct(varModel, total, 1)} of ${vl}).`] : []),
    `- Risk mix: ${levels.critical} critical · ${levels.high} high · ${levels.medium} medium · ${levels.low} low. Average composite score **${avg.toFixed(1)}/100** now${trendStart != null ? ` (stored daily history: ${trendStart.toFixed(1)} 30 days ago → ${trend.at(-1)!.y.toFixed(1)} on ${trend.at(-1)!.x})` : ""}.`,
    `- Dominant hazard right now: **${dominant.h}** (average ${dominant.avg.toFixed(0)}/100; ${plural(dominant.count, nounFor(rows, 1), nounFor(rows, 2))} ≥ 60).`,
  ];
  if (topDrivers.length) lines.push(`- Main drivers on at-risk ${noun}: ${topDrivers.map(([d, c]) => `${d} (${c})`).join("; ")}.`);
  if (sorted[0]) lines.push(`- Highest score: **${sorted[0].name}** — ${sorted[0].composite}/100 (${sorted[0].level})${sorted[0].district ? `, ${sorted[0].district}` : ""}.`);
  if (args.hazard && args.hazard !== "composite") {
    const h = asHazard(args.hazard) as "flood" | "salinity" | "drought" | "heat";
    const hh = hz.find((x) => x.h === h)!;
    lines.push(`- ${cap(HAZARD_LABEL[h])}: ${plural(hh.count, nounFor(rows, 1), nounFor(rows, 2))} score ≥ 60 (average ${hh.avg.toFixed(0)}/100).`);
  }

  const artifacts: Artifact[] = [
    {
      kind: "kpis",
      items: [
        { label: cap(noun), value: num(n), sub: scope || ws.region || undefined },
        ...(ws.kind === "assets" ? [{ label: cap(vl), value: usd(total) }] : []),
        { label: "At risk (≥ threshold)", value: `${num(atRisk.length)}`, sub: pct(atRisk.length, n), tone: atRisk.length ? "warn" : "good" } as const,
        ...(ws.kind === "assets" ? [{ label: "Exposure at risk", value: usd(var_), sub: pct(var_, total), tone: var_ > 0 ? "warn" : "good" } as const, { label: "Value-at-risk (VaR)", value: usd(varModel), sub: `${pct(varModel, total, 1)} of ${vl}`, tone: varModel > 0 ? "bad" : "good" } as const] : []),
        { label: "Avg composite", value: avg.toFixed(1), sub: "/100", tone: avg >= 60 ? "bad" : avg >= 35 ? "warn" : "good" },
      ],
    },
  ];
  if (trend.length > 2) artifacts.push({ kind: "chart", title: "Average composite score — last 30 days", type: "line", unit: "/100", series: [{ name: "Avg composite", data: trend }] });
  if (countries.size > 1)
    artifacts.push({
      kind: "table",
      title: "By country",
      columns: [
        { key: "country", label: "Country" },
        { key: "count", label: cap(nounFor(rows, 2)), align: "right", format: "number" },
        { key: "atRisk", label: "At risk", align: "right", format: "number" },
        { key: "avg", label: "Avg score", align: "right", format: "score" },
        ...(ws.kind === "assets" ? [{ key: "value", label: cap(vl), align: "right" as const, format: "money" as const }] : []),
      ],
      rows: [...countries.entries()].map(([country, rs]) => ({
        country,
        count: rs.length,
        atRisk: rs.filter((r) => r.composite >= ws.riskThreshold).length,
        avg: Math.round(rs.reduce((t, r) => t + r.composite, 0) / rs.length),
        value: rs.reduce((t, r) => t + r.valueUsd, 0),
      })),
    });
  artifacts.push({ kind: "map", title: `${cap(noun)} coloured by composite score`, markers: markers(sorted, 150) });

  return {
    data: {
      org: ws.orgName,
      filter: f,
      count: n,
      unit: noun,
      totalValueUsd: total,
      valueLabel: vl,
      riskThreshold: ws.riskThreshold,
      atRiskCount: atRisk.length,
      exposureAtRiskUsd: var_,
      valueAtRiskUsd: Math.round(varModel),
      varFormula: "VaR = Σ value × (composite/100) × Σₕ (hazard share × mean damage ratio); MDR flood 45%, drought 35%, salinity 30%, heat 20%",
      avgComposite: Math.round(avg * 10) / 10,
      avgComposite30dAgo: trendStart ?? null,
      levels,
      hazards: hz.map((x) => ({ hazard: x.h, countAtOrAbove60: x.count, average: Math.round(x.avg) })),
      topDrivers: topDrivers.map(([d, c]) => ({ driver: d, assets: c })),
      highest: sorted.slice(0, 3).map((r) => ({ name: r.name, composite: r.composite, level: r.level, district: r.district })),
    },
    markdown: lines.join("\n"),
    artifacts,
    actions: [
      { label: "Open portfolio", href: LINKS.portfolio(f.country ? { country: f.country } : {}), kind: "portfolio" },
      ...(sorted[0] ? [{ label: `Open ${sorted[0].name}`, href: sorted[0].href, kind: "asset" as const }] : []),
    ],
    sources: wsSource(ws),
    followUps: [`Top 10 ${nounFor(rows, 2)} by ${dominant.h} risk`, ...(sorted[0] ? [`Tell me about ${sorted[0].ref ?? sorted[0].name}`] : []), "Which alert rules fired this week?"],
  };
}

// ─── 2. Top-risk assets ──────────────────────────────────────────────────

const DRIVER_HINT: Record<Hazard, RegExp> = { flood: /flood|river|rain/i, salinity: /salt/i, drought: /evapor|dry/i, heat: /heat/i, composite: /./ };
function driverFor(r: Row, hazard: Hazard): string | null {
  const d = r.drivers.filter((x) => x !== "No significant hazard in the forecast window");
  return d.find((x) => DRIVER_HINT[hazard].test(x)) ?? d[0] ?? null;
}

function thresholdMetric(t: Threshold, hazard: Hazard): { key: keyof Row; label: string } {
  if (t.unit === "mm") return { key: "rain72", label: "72 h rain (mm)" };
  if (t.unit === "dS/m") return { key: "ec", label: "EC (dS/m)" };
  return { key: HAZARD_KEY[hazard], label: HAZARD_LABEL[hazard] };
}
const cmp = (a: number, op: Threshold["op"], b: number) => (op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b);

async function topRiskAssets(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  const hazard = asHazard(args.hazard);
  const limit = Math.min(50, Math.max(1, nbr(args.limit) ?? 10));
  const f: RowFilter = { country: str(args.country), types: strArr(args.types), crop: str(args.crop), tag: str(args.tag), area: str(args.area) };
  const level = str(args.level);
  const th = (args.threshold && typeof args.threshold === "object" ? args.threshold : null) as Threshold | null;
  if (!ws.rows.length) return empty("Your workspace has no monitored assets yet.");
  let rows = applyFilter(ws.rows, f);
  const scope = describeFilter(f);
  if (!rows.length) return empty(`No ${nounFor(ws.rows, 2)} match ${scope || "that filter"} in your workspace.`, { data: { error: "no_match", filter: f } });
  const key = HAZARD_KEY[hazard];
  if (level === "critical") rows = rows.filter((r) => r.level === "critical");
  else if (level === "high") rows = rows.filter((r) => r.level === "high" || r.level === "critical");
  else if (level === "medium") rows = rows.filter((r) => r.level === "medium");
  else if (level === "low") rows = rows.filter((r) => r.level === "low");
  let thLabel = "";
  if (th && Number.isFinite(th.value)) {
    const m = thresholdMetric(th, hazard);
    const before = rows.length;
    rows = rows.filter((r) => typeof r[m.key] === "number" && cmp(r[m.key] as number, th.op, th.value));
    thLabel = `${m.label} ${th.op} ${th.value}${th.unit === "%" ? "%" : ""}`;
    if (!rows.length) {
      const pool = applyFilter(ws.rows, f);
      const best = [...pool].sort((a, b) => ((b[m.key] as number) ?? -1) - ((a[m.key] as number) ?? -1))[0];
      const bestV = best ? (best[m.key] as number | null) : null;
      return {
        data: { matches: 0, threshold: th, filter: f, checked: before, highest: best ? { name: best.name, value: bestV } : null },
        markdown: `**None** of your ${plural(before, nounFor(pool, before), nounFor(pool, 2))}${scope ? ` ${scope}` : ""} currently has ${thLabel}.${best && bestV != null ? ` The highest is **${best.name}** at **${Math.round(bestV * 10) / 10}**.` : ""}`,
        artifacts: [],
        actions: [{ label: `Alert me when ${thLabel}`, href: LINKS.newRule({ metric: th.unit === "mm" ? "rain_72h_mm" : th.unit === "dS/m" ? "salinity_ec" : RULE_FOR[hazard].metric, op: th.op, value: th.value, ...(f.tag ? { tags: f.tag } : {}) }), kind: "rule" }],
        sources: wsSource(ws),
        followUps: [`Top 10 by ${HAZARD_LABEL[hazard]}`, "Portfolio summary"],
      };
    }
  }
  const sorted = [...rows].sort((a, b) => b[key] - a[key] || b.composite - a.composite || a.name.localeCompare(b.name));
  const top = sorted.slice(0, limit);
  const noun = nounFor(rows, 2);
  const totalValue = top.reduce((t, r) => t + r.valueUsd, 0);
  const lines = [
    `${th || level ? `**${num(rows.length)}** ${noun}${scope ? ` ${scope}` : ""} match${thLabel ? ` ${thLabel}` : ""}${level ? ` (level ${level}${level === "high" ? " or critical" : ""})` : ""}. ` : ""}Top **${top.length}** by **${HAZARD_LABEL[hazard]}**${!th && !level && scope ? ` (${scope})` : ""}:`,
    ...top.slice(0, 5).map((r, i) => `${i + 1}. **${r.name}**${r.district ? ` (${r.district})` : ""} — ${HAZARD_LABEL[hazard]} **${r[key]}**/100${hazard !== "composite" ? `, composite ${r.composite}` : ""} · ${r.level}${driverFor(r, hazard) ? ` · ${driverFor(r, hazard)}` : ""}`),
  ];
  if (top.length > 5) lines.push(`…and ${top.length - 5} more in the table below.`);
  if (ws.kind === "assets") lines.push(`Together these ${top.length} carry **${usd(totalValue)}** of ${valueLabel(ws, top)}.`);
  const rule = RULE_FOR[hazard];
  return {
    data: {
      hazard,
      filter: f,
      level: level ?? null,
      threshold: th,
      matches: rows.length,
      top: top.map((r) => ({ id: r.id, name: r.name, ref: r.ref, district: r.district, country: r.country, [key]: r[key], composite: r.composite, level: r.level, valueUsd: r.valueUsd, rain72hMm: r.rain72, ec: r.ec, drivers: r.drivers.slice(0, 2) })),
    },
    markdown: lines.join("\n"),
    artifacts: [
      {
        kind: "table",
        title: `Top ${top.length} ${noun} by ${HAZARD_LABEL[hazard]}`,
        hrefKey: "href",
        columns: [
          { key: "name", label: "Asset" },
          { key: "ref", label: "Reference" },
          { key: "district", label: "District" },
          ...(hazard !== "composite" ? [{ key: "hazard", label: cap(hazard), align: "right" as const, format: "score" as const }] : []),
          { key: "composite", label: "Composite", align: "right", format: "score" },
          { key: "level", label: "Level", format: "level" },
          ...(th?.unit === "mm" ? [{ key: "rain72", label: "Rain 72h (mm)", align: "right" as const, format: "number" as const }] : []),
          ...(th?.unit === "dS/m" || hazard === "salinity" ? [{ key: "ec", label: "EC dS/m", align: "right" as const, format: "number" as const }] : []),
          ...(ws.kind === "assets" ? [{ key: "value", label: "Value", align: "right" as const, format: "money" as const }] : []),
        ],
        rows: top.map((r) => ({ name: r.name, ref: r.ref, district: r.district ?? r.country, hazard: r[key], composite: r.composite, level: r.level, rain72: r.rain72, ec: r.ec == null ? null : Math.round(r.ec * 10) / 10, value: r.valueUsd, href: r.href })),
      },
      { kind: "map", title: "Where they are", markers: markers(top) },
    ],
    actions: [
      ...(top[0] ? [{ label: `Open ${top[0].name}`, href: top[0].href, kind: "asset" as const }] : []),
      { label: `Create rule: ${HAZARD_LABEL[hazard]} alert`, href: LINKS.newRule({ metric: th?.unit === "mm" ? "rain_72h_mm" : th?.unit === "dS/m" ? "salinity_ec" : rule.metric, op: th?.op ?? ">", value: th?.value ?? rule.value, ...(f.tag ? { tags: f.tag } : {}), ...(f.country ? { countries: f.country } : {}) }), kind: "rule" },
      { label: "Open in portfolio", href: LINKS.portfolio({ sort: key, ...(f.country ? { country: f.country } : {}), ...(f.tag ? { tag: f.tag } : {}) }), kind: "portfolio" },
    ],
    sources: wsSource(ws),
    followUps: top[0] ? [`Tell me about ${top[0].ref ?? top[0].name}`, `Forecast for ${top[0].district ?? top[0].country} next 7 days`, "Portfolio summary"] : [],
  };
}

// ─── 3. Asset detail ──────────────────────────────────────────────────────

async function assetDetail(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const ref = str(args.asset);
  if (!ref) return empty("Which asset? Give me its name, reference or ID.");
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  const hits = findAssets(ws.rows, ref);
  if (!hits.length) return empty(`I couldn't find an asset matching “${ref}” in ${ws.orgName}.`, { followUps: ["Top 10 assets by composite score"] });
  if (hits.length > 1) {
    return {
      data: { ambiguous: true, candidates: hits.map((h) => ({ id: h.id, name: h.name, ref: h.ref })) },
      markdown: `“${ref}” matches **${hits.length}** assets — which one did you mean?`,
      artifacts: [{ kind: "table", title: "Matching assets", hrefKey: "href", columns: [{ key: "name", label: "Asset" }, { key: "ref", label: "Reference" }, { key: "composite", label: "Composite", align: "right", format: "score" }], rows: hits.map((h) => ({ name: h.name, ref: h.ref, composite: h.composite, href: h.href })) }],
      actions: [],
      sources: [SRC_STORE],
      followUps: hits.slice(0, 3).map((h) => `Tell me about ${h.ref ?? h.id}`),
    };
  }
  const a = hits[0]!;
  const meta = Object.entries(a.meta).filter(([, v]) => v !== null && v !== "" && v !== 0 && v !== false);
  const META_LABEL: Record<string, string> = { product: "Product", season: "Season", premiumUsd: "Premium (USD)", deductiblePct: "Deductible %", principalUsd: "Principal (USD)", tenorMonths: "Tenor (months)", interestRatePct: "Interest %", daysPastDue: "Days past due", internalRating: "Internal rating", collateral: "Collateral", households: "Households", population: "Population", cashPerHouseholdUsd: "Cash / household (USD)", femaleHeadedPct: "Female-headed %", cycloneShelterKm: "Nearest cyclone shelter (km)", capacityTonnes: "Capacity (t)", utilizationPct: "Utilisation %", memberSince: "Member since", irrigation: "Irrigation", basin: "Basin" };
  const drivers = a.drivers.length ? a.drivers : ["No significant hazard in the forecast window"];
  const lines = [
    `**${a.name}**${a.ref ? ` (${a.ref})` : ""} — ${a.district ? `${a.district}, ` : ""}${a.country}${a.crop ? ` · ${a.crop}` : ""}.`,
    `Composite climate risk **${a.composite}/100 (${a.level})**: flood ${a.flood} · salinity ${a.salinity} · drought ${a.drought} · heat ${a.heat}.`,
    `Why: ${drivers.join("; ")}.`,
  ];
  if (a.rain72 != null) lines.push(`Forecast rain: ${a.rain24 ?? 0} mm next 24 h, **${a.rain72} mm** next 72 h${a.ec != null ? `; soil salinity ~${a.ec.toFixed(1)} dS/m` : ""}${a.dischargeRatio != null ? `; river discharge ${a.dischargeRatio}× its 30-day mean` : ""}.`);
  if (ws.kind === "assets") lines.push(`Exposure: **${usd(a.valueUsd, false)}** ${valueLabel(ws, [a])}.`);
  const h = a.history;
  if (h.length > 7) lines.push(`Stored daily history: ${h[0]!.composite} on ${h[0]!.date} → ${h.at(-1)!.composite} on ${h.at(-1)!.date}; live score now ${a.composite}.`);
  lines.push(`_Scored ${a.assessedAt ? new Date(a.assessedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"} · ${a.scoreSource}_`);
  return {
    data: { asset: { id: a.id, name: a.name, ref: a.ref, type: a.type, district: a.district, country: a.country, crop: a.crop, tags: a.tags, valueUsd: a.valueUsd, meta: a.meta }, scores: { composite: a.composite, level: a.level, flood: a.flood, salinity: a.salinity, drought: a.drought, heat: a.heat }, drivers, rain24hMm: a.rain24, rain72hMm: a.rain72, ecDsm: a.ec, dischargeRatio: a.dischargeRatio, assessedAt: a.assessedAt, scoreSource: a.scoreSource },
    markdown: lines.join("\n"),
    artifacts: [
      {
        kind: "kpis",
        items: [
          { label: "Composite", value: `${a.composite}`, sub: a.level, tone: a.level === "critical" ? "critical" : a.level === "high" ? "bad" : a.level === "medium" ? "warn" : "good" },
          { label: "Flood (72 h)", value: `${a.flood}%` },
          { label: "Salinity", value: `${a.salinity}`, sub: a.ec != null ? `${a.ec.toFixed(1)} dS/m` : undefined },
          { label: "Drought", value: `${a.drought}` },
          { label: "Heat", value: `${a.heat}` },
          ...(ws.kind === "assets" ? [{ label: cap(valueLabel(ws, [a])), value: usd(a.valueUsd) }] : []),
        ],
      },
      ...(meta.length ? [{ kind: "table" as const, title: "Record details", columns: [{ key: "k", label: "Field" }, { key: "v", label: "Value" }], rows: meta.map(([k, v]) => ({ k: META_LABEL[k] ?? k, v: typeof v === "number" ? num(v, 1) : String(v) })) }] : []),
      ...(h.length > 2 ? [{ kind: "chart" as const, title: "Composite score — last 30 days", type: "line" as const, unit: "/100", series: [{ name: a.name, data: [...h.map((x) => ({ x: x.date, y: x.composite })), ...(a.assessedAt && a.assessedAt.slice(0, 10) !== h.at(-1)?.date ? [{ x: `${a.assessedAt.slice(0, 10)} (live)`, y: a.composite }] : [])] }] }] : []),
      { kind: "map", markers: [{ lat: a.lat, lon: a.lon, label: a.name, score: a.composite, href: a.href, kind: "asset" }] },
    ],
    actions: [
      { label: "Open asset", href: a.href, kind: "asset" },
      { label: "Open in Explorer", href: LINKS.explorer(a.lat, a.lon, a.name), kind: "explorer" },
      { label: "Create rule for this asset", href: LINKS.newRule({ assetIds: a.id, metric: "composite", op: ">", value: Math.max(60, Math.min(90, a.composite + 10)) }), kind: "rule" },
    ],
    sources: wsSource(ws),
    followUps: [`Forecast for ${a.ref ?? a.name}`, `Compare ${a.district ?? a.country} and ${a.country === "Bangladesh" ? "Khulna" : "Cà Mau"}`, "Top 10 assets by composite score"],
  };
}

// ─── 4. Location assessment (any place on Earth) ─────────────────────────

async function assessPlace(query: string): Promise<{ place: ResolvedPlace; report: LocationRiskReport } | { error: string }> {
  const place = await resolvePlace(query);
  if (!place) return { error: `I couldn't find “${query}” (geocoding returned no match or is unreachable). Try adding the country, e.g. “${query}, India”.` };
  const report = await assessLocation(place.lat, place.lon, { name: place.name });
  return { place, report };
}

function placeLabel(p: ResolvedPlace) {
  return `${p.name}${p.admin1 && p.admin1 !== p.name ? `, ${p.admin1}` : ""}${p.country ? `, ${p.country}` : ""}`;
}

async function assessLocationTool(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const q = str(args.place);
  if (!q) return empty("Which place should I assess?");
  const res = await assessPlace(q);
  if ("error" in res) return empty(res.error);
  trackUsage(ctx.orgId, "assessments");
  const { place, report: r } = res;
  const fz = r.hazards;
  const focus = str(args.focus);
  const rain7 = r.forecast.daily.slice(1, 8).reduce((t, d) => t + (d.precipMm ?? 0), 0);
  const lines = [
    `**${placeLabel(place)}** (${place.lat.toFixed(3)}, ${place.lon.toFixed(3)}${r.location.elevationM != null ? `, ${Math.round(r.location.elevationM)} m elevation` : ""}): **${cap(r.composite.level)} overall climate risk — ${r.composite.score}/100.**`,
    `- Flood: **${Math.round(fz.flood.p72 * 100)}%** chance in 72 h (24 h: ${Math.round(fz.flood.p24 * 100)}%)${fz.flood.depthM ? `, est. depth ${fz.flood.depthM.toFixed(2)} m` : ""}${fz.flood.model === "unavailable" ? " — flood model unavailable" : ""}.`,
    fz.salinity.applicable ? `- Salinity: EC **${fz.salinity.ecNow.toFixed(1)} dS/m** now → ${fz.salinity.ec30d.toFixed(1)} dS/m in 30 days (${fz.salinity.class}); crop damage probability ${Math.round(fz.salinity.cropDamageProb * 100)}%.` : `- Salinity: not a material hazard here (inland / low tidal influence).`,
    `- Drought: 7-day water balance **${fz.drought.waterBalance7dMm} mm** (rain ${fz.drought.rain7dForecastMm} mm vs ET₀ ${fz.drought.et0_7dMm} mm) → score ${fz.drought.score}/100.`,
    `- Heat: max ${fz.heat.maxTempC != null ? `${fz.heat.maxTempC.toFixed(1)} °C` : "n/a"}, ${fz.heat.hotDays} day(s) ≥ 35 °C → score ${fz.heat.score}/100.`,
  ];
  if (r.river?.ratio != null) lines.push(`- River: forecast peak discharge ${r.river.dischargeM3s} m³/s = **${r.river.ratio}×** its 30-day mean (GloFAS).`);
  lines.push(`- Drivers: ${r.composite.drivers.join("; ")}.`);
  if (focus === "hazards" || r.hazardsNearby.length) {
    lines.push(r.hazardsNearby.length ? `- Active hazard events within 800 km: ${r.hazardsNearby.slice(0, 3).map((h) => `${h.title} (${h.distanceKm} km, ${h.source})`).join("; ")}.` : `- No active GDACS / NASA EONET events within 800 km.`);
  }
  if (!r.location.inCoreCoverage) lines.push(`_Outside our core calibrated deltas (nearest monitored district ${r.location.nearestDistrictKm} km away) — flood/salinity priors are generic, forecasts are global._`);
  const failed = r.sources.filter((s) => !s.ok).map((s) => s.name);
  if (failed.length) lines.push(`_Unavailable right now: ${failed.join(", ")}._`);
  return {
    data: {
      place: placeLabel(place),
      lat: place.lat,
      lon: place.lon,
      resolvedVia: place.via,
      composite: r.composite,
      flood: { p24: fz.flood.p24, p72: fz.flood.p72, depthM: fz.flood.depthM, model: fz.flood.model },
      salinity: { applicable: fz.salinity.applicable, ecNow: fz.salinity.ecNow, ec30d: fz.salinity.ec30d, class: fz.salinity.class },
      drought: fz.drought,
      heat: fz.heat,
      river: r.river ? { dischargeM3s: r.river.dischargeM3s, ratio: r.river.ratio } : null,
      rain7dMm: Math.round(rain7 * 10) / 10,
      hazardsNearby: r.hazardsNearby.slice(0, 5).map((h) => ({ title: h.title, type: h.type, km: h.distanceKm, source: h.source })),
      inCoreCoverage: r.location.inCoreCoverage,
      sourcesUnavailable: failed,
    },
    markdown: lines.join("\n"),
    artifacts: [
      {
        kind: "kpis",
        items: [
          { label: "Composite", value: `${r.composite.score}`, sub: r.composite.level, tone: r.composite.level === "critical" ? "critical" : r.composite.level === "high" ? "bad" : r.composite.level === "medium" ? "warn" : "good" },
          { label: "Flood 72 h", value: `${Math.round(fz.flood.p72 * 100)}%` },
          { label: "Salinity EC", value: fz.salinity.applicable ? `${fz.salinity.ecNow.toFixed(1)}` : "n/a", sub: fz.salinity.applicable ? "dS/m" : undefined },
          { label: "Water balance 7 d", value: `${fz.drought.waterBalance7dMm}`, sub: "mm" },
          { label: "Max temp", value: fz.heat.maxTempC != null ? `${fz.heat.maxTempC.toFixed(1)}°` : "n/a", sub: "°C" },
        ],
      },
      ...(r.forecast.daily.length ? [{ kind: "chart" as const, title: "Daily rainfall forecast (mm)", type: "bar" as const, unit: "mm", series: [{ name: "Rain", data: r.forecast.daily.map((d) => ({ x: d.date, y: Math.round((d.precipMm ?? 0) * 10) / 10 })) }] }] : []),
      { kind: "map", markers: [{ lat: place.lat, lon: place.lon, label: placeLabel(place), score: r.composite.score, kind: "place" }, ...r.hazardsNearby.slice(0, 5).map((h) => ({ lat: h.lat, lon: h.lon, label: `${h.title} (${h.distanceKm} km)`, kind: "hazard" as const }))] },
    ],
    actions: [
      { label: `Open ${place.name} in Explorer`, href: LINKS.explorer(place.lat, place.lon, place.name), kind: "explorer" },
      { label: "Watch this place with a rule", href: LINKS.newRule({ metric: "flood_prob_72h", op: ">", value: 60, place: place.name }), kind: "rule" },
    ],
    sources: [`${place.via === "monitored district" ? "Agri-SHIELD district registry" : "Open-Meteo geocoding"}`, ...r.sources.filter((s) => s.ok).map((s) => s.name)],
    followUps: [`Forecast for ${place.name} next 7 days`, `Compare ${place.name} and ${place.country === "Bangladesh" ? "Khulna" : "Dhaka"}`, "What does the composite score mean?"],
  };
}

// ─── 5. Forecast ──────────────────────────────────────────────────────────

async function forecastTool(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const days = Math.min(16, Math.max(1, Math.round(nbr(args.days) ?? 7)));
  let point: { lat: number; lon: number; label: string; href?: string } | null = null;
  const assetRef = str(args.asset);
  const placeQ = str(args.place);
  let viaNote = "";
  if (assetRef) {
    const ws = await loadWorkspace(ctx.orgId, ctx.userId);
    const hits = findAssets(ws.rows, assetRef);
    if (hits.length !== 1) return empty(hits.length ? `“${assetRef}” matches ${hits.length} assets — please be more specific.` : `I couldn't find an asset matching “${assetRef}”.`);
    point = { lat: hits[0]!.lat, lon: hits[0]!.lon, label: hits[0]!.name, href: hits[0]!.href };
  } else if (placeQ) {
    const p = await resolvePlace(placeQ);
    if (!p) return empty(`I couldn't find “${placeQ}”. Try adding the country.`);
    point = { lat: p.lat, lon: p.lon, label: placeLabel(p) };
  } else {
    const s = getStore();
    const org = s.orgs.find((o) => o.id === ctx.orgId);
    const c = org?.settings?.defaultCenter ?? [22.5, 90];
    point = { lat: c[0], lon: c[1], label: `${org?.region ?? "your workspace's home region"} (map centre)` };
    viaNote = " No place was named, so I used your workspace's default map centre.";
  }
  let fc;
  try {
    // 8-day requests share the cache with the location engine (fewer upstream calls)
    fc = (await getForecast([{ lat: point.lat, lon: point.lon }], days <= 7 ? 8 : 16))[0];
  } catch {
    fc = undefined;
  }
  if (!fc) return empty(`The live forecast service (Open-Meteo) is unavailable right now (network or rate limit), so I can't give a forecast for ${point.label}. Try again in a minute.`);
  // daily[0] is yesterday (past_days=1)
  const today = new Date().toISOString().slice(0, 10);
  const start = Math.max(0, fc.daily.time.indexOf(today));
  const idx = fc.daily.time.map((_, i) => i).slice(start, start + days);
  const daily = idx.map((i) => ({ date: fc.daily.time[i]!, rain: fc.daily.precipitation_sum[i] ?? 0, prob: fc.daily.precipitation_probability_max[i] ?? 0, tmax: fc.daily.temperature_2m_max[i] ?? null, tmin: fc.daily.temperature_2m_min[i] ?? null, et0: fc.daily.et0_fao_evapotranspiration[i] ?? null }));
  const total = daily.reduce((t, d) => t + d.rain, 0);
  const wettest = [...daily].sort((a, b) => b.rain - a.rain)[0]!;
  const tmax = Math.max(...daily.map((d) => d.tmax ?? -99));
  const et0 = daily.reduce((t, d) => t + (d.et0 ?? 0), 0);
  const heavy = daily.filter((d) => d.rain >= 50).length;
  const cur = fc.current;
  const lines = [
    `**${days}-day forecast for ${point.label}**${viaNote}`,
    cur ? `- Now: ${weatherLabel(cur.weather_code)}, ${cur.temperature_2m.toFixed(1)} °C, humidity ${cur.relative_humidity_2m}%, wind ${Math.round(cur.wind_speed_10m)} km/h.` : "",
    `- Total rain: **${total.toFixed(1)} mm**; wettest day **${wettest.date}** with ${wettest.rain.toFixed(1)} mm (rain chance up to ${wettest.prob}%).${heavy ? ` **${heavy} day(s) of very heavy rain (≥ 50 mm).**` : ""}`,
    `- Temperatures: up to **${tmax.toFixed(1)} °C**${tmax >= 35 ? " — heat stress likely for crops" : ""}; evaporation demand (ET₀) ${et0.toFixed(1)} mm → water balance ${(total - et0).toFixed(1)} mm.`,
  ].filter(Boolean);
  return {
    data: { place: point.label, lat: point.lat, lon: point.lon, days, totalRainMm: Math.round(total * 10) / 10, wettestDay: wettest, maxTempC: tmax, et0Mm: Math.round(et0 * 10) / 10, heavyRainDays: heavy, current: cur ? { label: weatherLabel(cur.weather_code), tempC: cur.temperature_2m, humidity: cur.relative_humidity_2m, windKmh: cur.wind_speed_10m } : null, daily },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [{ label: `Rain, ${days} d`, value: `${total.toFixed(0)} mm`, tone: total > 150 ? "bad" : total > 60 ? "warn" : "neutral" }, { label: "Wettest day", value: `${wettest.rain.toFixed(0)} mm`, sub: wettest.date.slice(5) }, { label: "Max temp", value: `${tmax.toFixed(1)}°C`, tone: tmax >= 35 ? "bad" : "neutral" }, { label: "Water balance", value: `${(total - et0).toFixed(0)} mm`, tone: total - et0 < -20 ? "warn" : "neutral" }] },
      { kind: "chart", title: "Daily rainfall (mm)", type: "bar", unit: "mm", series: [{ name: "Rain", data: daily.map((d) => ({ x: d.date, y: Math.round(d.rain * 10) / 10 })) }] },
      { kind: "chart", title: "Daily max / min temperature (°C)", type: "line", unit: "°C", series: [{ name: "Max", color: "#f87171", data: daily.map((d) => ({ x: d.date, y: d.tmax })) }, { name: "Min", color: "#38bdf8", data: daily.map((d) => ({ x: d.date, y: d.tmin })) }] },
    ],
    actions: [{ label: "Open in Explorer", href: LINKS.explorer(point.lat, point.lon, point.label.split(",")[0]), kind: "explorer" }, ...(point.href ? [{ label: "Open asset", href: point.href, kind: "asset" as const }] : []), { label: "Alert me on heavy rain", href: LINKS.newRule({ metric: "rain_72h_mm", op: ">=", value: 120 }), kind: "rule" }],
    sources: ["Open-Meteo forecast (ECMWF/GFS/ICON blend)"],
    followUps: [`What is the flood risk in ${point.label.split(",")[0]}?`, "Which of my assets get the most rain?"],
  };
}

// ─── 6. Compare places ────────────────────────────────────────────────────

async function comparePlacesTool(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const places = (strArr(args.places) ?? []).slice(0, 4);
  if (places.length < 2) return empty("Name at least two places to compare, e.g. “Compare Khulna and Cà Mau”.");
  const hazard = asHazard(args.hazard ?? "composite");
  const res = await Promise.all(places.map((p) => assessPlace(p)));
  const ok = res.flatMap((r, i) => ("error" in r ? [] : [{ q: places[i]!, ...r }]));
  const missing = places.filter((_, i) => "error" in res[i]!);
  if (ok.length < 2) return empty(`I could only resolve ${ok.length} of those places${missing.length ? ` (not found: ${missing.join(", ")})` : ""}.`);
  trackUsage(ctx.orgId, "assessments", ok.length);
  const metric = (r: LocationRiskReport) => (hazard === "flood" ? Math.round(r.hazards.flood.p72 * 100) : hazard === "salinity" ? r.hazards.salinity.score : hazard === "drought" ? r.hazards.drought.score : hazard === "heat" ? r.hazards.heat.score : r.composite.score);
  const ranked = [...ok].sort((a, b) => metric(b.report) - metric(a.report));
  const lead = ranked[0]!;
  const last = ranked.at(-1)!;
  const rows = ok.map(({ place, report: r }) => ({
    place: placeLabel(place),
    composite: r.composite.score,
    level: r.composite.level,
    flood: Math.round(r.hazards.flood.p72 * 100),
    ec: r.hazards.salinity.applicable ? Math.round(r.hazards.salinity.ecNow * 10) / 10 : null,
    balance: r.hazards.drought.waterBalance7dMm,
    tmax: r.hazards.heat.maxTempC == null ? null : Math.round(r.hazards.heat.maxTempC * 10) / 10,
    driver: r.composite.drivers[0] ?? "",
    href: LINKS.explorer(place.lat, place.lon, place.name),
  }));
  const unit = hazard === "flood" ? "% in 72 h" : "/100";
  const tie = metric(lead.report) === metric(last.report);
  const lines = [
    tie
      ? `By **${HAZARD_LABEL[hazard]}**, the places are level: all score **${metric(lead.report)}${unit}** right now.`
      : `By **${HAZARD_LABEL[hazard]}**, **${lead.place.name}** is the most exposed (${metric(lead.report)}${hazard === "flood" ? "% in 72 h" : "/100"}) and **${last.place.name}** the least (${metric(last.report)}${hazard === "flood" ? "%" : "/100"}).`,
    ...ok.map(({ place, report: r }) => `- **${place.name}**: composite ${r.composite.score}/100 (${r.composite.level}); flood ${Math.round(r.hazards.flood.p72 * 100)}% / 72 h; ${r.hazards.salinity.applicable ? `EC ${r.hazards.salinity.ecNow.toFixed(1)} dS/m` : "salinity n/a"}; water balance ${r.hazards.drought.waterBalance7dMm} mm; max ${r.hazards.heat.maxTempC?.toFixed(1) ?? "n/a"} °C — ${r.composite.drivers[0]}.`),
  ];
  if (missing.length) lines.push(`_Not found: ${missing.join(", ")}._`);
  const down = Array.from(new Set(ok.flatMap(({ report }) => report.sources.filter((x) => !x.ok).map((x) => x.name))));
  if (down.length) lines.push(`_Unavailable right now: ${down.join(", ")} — affected figures fall back to baselines or show n/a._`);
  return {
    data: { hazard, places: rows.map(({ href: _h, ...r }) => r), missing },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "table", title: "Side by side", hrefKey: "href", columns: [{ key: "place", label: "Place" }, { key: "composite", label: "Composite", align: "right", format: "score" }, { key: "level", label: "Level", format: "level" }, { key: "flood", label: "Flood 72h %", align: "right", format: "number" }, { key: "ec", label: "EC dS/m", align: "right", format: "number" }, { key: "balance", label: "Water bal. mm", align: "right", format: "number" }, { key: "tmax", label: "Max °C", align: "right", format: "number" }], rows },
      { kind: "chart", title: `${cap(HAZARD_LABEL[hazard])} by place`, type: "bar", unit: hazard === "flood" ? "%" : "/100", series: [{ name: cap(HAZARD_LABEL[hazard]), data: ok.map(({ place, report }) => ({ x: place.name, y: metric(report) })) }] },
      { kind: "map", markers: ok.map(({ place, report }) => ({ lat: place.lat, lon: place.lon, label: placeLabel(place), score: report.composite.score, href: LINKS.explorer(place.lat, place.lon, place.name), kind: "place" as const })) },
    ],
    actions: ok.map(({ place }) => ({ label: `Explore ${place.name}`, href: LINKS.explorer(place.lat, place.lon, place.name), kind: "explorer" as const })),
    sources: ["Open-Meteo geocoding / district registry", "Open-Meteo forecast", "GloFAS v4", "Agri-SHIELD flood & salinity models"],
    followUps: [`Forecast for ${lead.place.name} next 7 days`, `What is driving the risk in ${lead.place.name}?`],
  };
}

// ─── 7. Alerts & rules ────────────────────────────────────────────────────

async function alertsAndRules(ctx: CopilotContext): Promise<ToolOutput> {
  const s = getStore();
  const rules = s.alertRules.filter((r) => r.workspaceId === ctx.orgId);
  const since = Date.now() - 7 * 86_400_000;
  const notes = s.notifications.filter((n) => n.workspaceId === ctx.orgId && (n.userId == null || n.userId === ctx.userId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const recentNotes = notes.filter((n) => n.createdAt.getTime() >= since);
  const firedWeek = rules.filter((r) => r.lastTriggeredAt && r.lastTriggeredAt.getTime() >= since);
  const districts = new Set(s.assets.filter((a) => a.workspaceId === ctx.orgId && a.districtId).map((a) => a.districtId!));
  for (const d of s.districts) if (d.orgId === ctx.orgId) districts.add(d.id);
  const govAlerts = s.alerts.filter((a) => a.isActive && districts.has(a.districtId) && a.validUntil.getTime() > Date.now());
  const dname = new Map(s.districts.map((d) => [d.id, d.name]));
  const ago = (d: Date | null) => {
    if (!d) return "never";
    const h = Math.round((Date.now() - d.getTime()) / 3_600_000);
    return h < 1 ? "just now" : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  };
  const lines = [
    `You have **${plural(rules.length, "alert rule", "alert rules")}** (${rules.filter((r) => r.enabled).length} enabled). **${firedWeek.length}** fired in the last 7 days${firedWeek.length ? `: ${firedWeek.map((r) => `“${r.name}” (${ago(r.lastTriggeredAt)})`).join(", ")}` : ""}.`,
    ...rules.slice(0, 6).map((r) => `- **${r.name}** — ${describeRule(r)} Fired ${r.triggerCount}× · last ${ago(r.lastTriggeredAt)}.`),
    `**${plural(recentNotes.length, "notification", "notifications")}** in the last 7 days${recentNotes.length ? `; latest: “${recentNotes[0]!.title}” (${ago(recentNotes[0]!.createdAt)})` : ""}.`,
    govAlerts.length ? `**${plural(govAlerts.length, "official early-warning alert", "official early-warning alerts")}** active in districts where you have assets: ${govAlerts.slice(0, 4).map((a) => `${a.title} (${dname.get(a.districtId) ?? a.districtId}, ${a.severity})`).join("; ")}.` : `No official early-warning alerts are active in your districts.`,
  ];
  if (!rules.length) lines.push("Create your first rule to get notified automatically when a threshold is crossed.");
  return {
    data: {
      rules: rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, conditions: r.conditions, scope: r.scope, severity: r.severity, channels: r.channels, triggerCount: r.triggerCount, lastTriggeredAt: r.lastTriggeredAt })),
      firedLast7d: firedWeek.map((r) => r.name),
      notificationsLast7d: recentNotes.slice(0, 10).map((n) => ({ title: n.title, body: n.body, severity: n.severity, at: n.createdAt })),
      officialAlerts: govAlerts.slice(0, 10).map((a) => ({ title: a.title, district: dname.get(a.districtId), severity: a.severity, type: a.alertType, validUntil: a.validUntil })),
    },
    markdown: lines.join("\n"),
    artifacts: [
      ...(rules.length ? [{ kind: "table" as const, title: "Alert rules", columns: [{ key: "name", label: "Rule" }, { key: "severity", label: "Severity" }, { key: "state", label: "State" }, { key: "fired", label: "Fired", align: "right" as const, format: "number" as const }, { key: "last", label: "Last fired" }], rows: rules.map((r) => ({ name: r.name, severity: r.severity, state: r.enabled ? "enabled" : "paused", fired: r.triggerCount, last: ago(r.lastTriggeredAt) })) }] : []),
      ...(notes.length ? [{ kind: "table" as const, title: "Recent notifications", hrefKey: "href", columns: [{ key: "title", label: "Notification" }, { key: "severity", label: "Severity" }, { key: "when", label: "When" }], rows: notes.slice(0, 8).map((n) => ({ title: n.title, severity: n.severity, when: ago(n.createdAt), href: n.href })) }] : []),
    ],
    actions: [{ label: "Open Alerts & Rules", href: LINKS.alerts(), kind: "alerts" }, { label: "Create a rule", href: LINKS.newRule({}), kind: "rule" }],
    sources: ["Agri-SHIELD alert rules & notification centre", "National early-warning alerts (Agri-SHIELD gov module)"],
    followUps: ["Which assets would trigger a flood rule above 60%?", "Portfolio summary"],
  };
}

// ─── 8. Hazards near assets ──────────────────────────────────────────────

async function hazardsNear(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const radius = Math.min(2000, Math.max(10, nbr(args.radiusKm) ?? 300));
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  if (!ws.rows.length) return empty("Your workspace has no monitored assets yet.");
  let events;
  try {
    events = await getHazardEvents();
  } catch {
    return empty("The live hazard feeds (GDACS, NASA EONET) are unreachable right now.");
  }
  const hits = events
    .map((ev) => {
      const near = ws.rows.map((r) => ({ r, km: haversineKm(ev.lat, ev.lon, r.lat, r.lon) })).filter((x) => x.km <= radius);
      const nearest = ws.rows.reduce((m, r) => Math.min(m, haversineKm(ev.lat, ev.lon, r.lat, r.lon)), Infinity);
      return { ev, near, nearest };
    })
    .filter((x) => x.near.length)
    .sort((a, b) => a.nearest - b.nearest);
  const noun = nounFor(ws.rows, 2);
  const closest = events.map((ev) => ({ ev, km: Math.min(...ws.rows.map((r) => haversineKm(ev.lat, ev.lon, r.lat, r.lon))) })).sort((a, b) => a.km - b.km)[0];
  const affected = new Set(hits.flatMap((h) => h.near.map((x) => x.r.id)));
  const affValue = ws.rows.filter((r) => affected.has(r.id)).reduce((t, r) => t + r.valueUsd, 0);
  const lines = hits.length
    ? [
        `**${plural(hits.length, "active hazard event", "active hazard events")}** within ${radius} km of your ${noun}, affecting **${plural(affected.size, nounFor(ws.rows, 1), noun)}**${ws.kind === "assets" ? ` (${usd(affValue)} exposure)` : ""}:`,
        ...hits.slice(0, 6).map((h) => `- **${h.ev.title}** (${h.ev.type}${h.ev.alertLevel ? `, ${h.ev.alertLevel} alert` : ""}, ${h.ev.source}, ${h.ev.date.slice(0, 10)}) — ${h.near.length} ${noun} within ${radius} km, nearest ${Math.round(h.nearest)} km.`),
      ]
    : [`**No active GDACS / NASA EONET events** within ${radius} km of your ${plural(ws.rows.length, nounFor(ws.rows, 1), noun)}.${closest ? ` The closest tracked event is “${closest.ev.title}” (${closest.ev.type}), ${Math.round(closest.km)} km away.` : ` ${events.length} events are being tracked globally.`}`];
  return {
    data: { radiusKm: radius, eventsTracked: events.length, events: hits.slice(0, 10).map((h) => ({ title: h.ev.title, type: h.ev.type, source: h.ev.source, alertLevel: h.ev.alertLevel, date: h.ev.date, nearestKm: Math.round(h.nearest), assetsWithinRadius: h.near.length })), affectedAssets: affected.size, affectedValueUsd: affValue, closestEvent: closest ? { title: closest.ev.title, km: Math.round(closest.km) } : null },
    markdown: lines.join("\n"),
    artifacts: [
      ...(hits.length ? [{ kind: "table" as const, title: "Events near your assets", columns: [{ key: "title", label: "Event" }, { key: "type", label: "Type" }, { key: "source", label: "Source" }, { key: "nearest", label: "Nearest km", align: "right" as const, format: "number" as const }, { key: "count", label: `${cap(noun)} ≤ ${radius} km`, align: "right" as const, format: "number" as const }], rows: hits.slice(0, 15).map((h) => ({ title: h.ev.title, type: h.ev.type, source: h.ev.source, nearest: Math.round(h.nearest), count: h.near.length })) }] : []),
      { kind: "map", title: "Events and exposed assets", markers: [...hits.slice(0, 15).map((h) => ({ lat: h.ev.lat, lon: h.ev.lon, label: h.ev.title, kind: "hazard" as const })), ...markers(ws.rows.filter((r) => affected.has(r.id)))] },
    ],
    actions: [{ label: "Open portfolio", href: LINKS.portfolio(), kind: "portfolio" }],
    sources: ["GDACS (EC JRC / UN OCHA)", "NASA EONET", SRC_STORE],
    followUps: ["Top 10 assets by flood risk", "Which alert rules fired this week?"],
  };
}

// ─── 9. Explain a metric ──────────────────────────────────────────────────

async function explainMetric(_ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const key = str(args.term)?.toLowerCase();
  const e = GLOSSARY.find((g) => g.key === key) ?? GLOSSARY.find((g) => key && (g.aliases.includes(key) || g.term.toLowerCase().includes(key)));
  if (!e) return empty(`I don't have a glossary entry for “${args.term}”. Known terms: ${GLOSSARY.map((g) => g.term.split(" (")[0]).join(", ")}.`);
  const lines = [`**${e.term}**${e.unit ? ` · unit: ${e.unit}` : ""}`, e.definition, `**How Agri-SHIELD computes it:** ${e.howWeCompute}`];
  if (e.goodToKnow) lines.push(`**Good to know:** ${e.goodToKnow}`);
  return { data: { ...e }, markdown: lines.join("\n\n"), artifacts: [], actions: [{ label: "Methodology docs", href: "/docs", kind: "module" }], sources: ["Agri-SHIELD methodology"], followUps: GLOSSARY.filter((g) => g.key !== e.key).slice(0, 3).map((g) => `What is ${g.term.split(" (")[0]}?`) };
}

// ─── 10. Insurance ────────────────────────────────────────────────────────

const PARAMETRIC_TRIGGER_MM = 150;

async function insuranceStats(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  let rows = ws.rows.filter((r) => r.type === "insured_plot");
  if (str(args.country)) rows = applyFilter(rows, { country: str(args.country) });
  if (!rows.length) return empty(`${ws.orgName} has no insured units in its portfolio, so there are no insurance statistics to report. (Insurance analytics apply to insured_plot assets.)`);
  const sumInsured = rows.reduce((t, r) => t + r.valueUsd, 0);
  const premium = rows.reduce((t, r) => t + (typeof r.meta.premiumUsd === "number" ? r.meta.premiumUsd : 0), 0);
  const byProduct = new Map<string, { n: number; si: number; prem: number }>();
  for (const r of rows) {
    const p = String(r.meta.product ?? "Unspecified");
    const x = byProduct.get(p) ?? { n: 0, si: 0, prem: 0 };
    x.n++;
    x.si += r.valueUsd;
    x.prem += typeof r.meta.premiumUsd === "number" ? r.meta.premiumUsd : 0;
    byProduct.set(p, x);
  }
  const parametric = rows.filter((r) => r.tags.includes("parametric"));
  const withRain = parametric.filter((r) => r.rain72 != null);
  const triggered = withRain.filter((r) => r.rain72! >= PARAMETRIC_TRIGGER_MM);
  const near = withRain.filter((r) => r.rain72! >= PARAMETRIC_TRIGGER_MM - 25 && r.rain72! < PARAMETRIC_TRIGGER_MM);
  const closest = [...withRain].sort((a, b) => b.rain72! - a.rain72!).slice(0, 10);
  const atRisk = rows.filter((r) => r.composite >= ws.riskThreshold);
  const siAtRisk = atRisk.reduce((t, r) => t + r.valueUsd, 0);
  const trigSI = triggered.reduce((t, r) => t + r.valueUsd, 0);
  const lines = [
    `**${plural(rows.length, "insured unit", "insured units")}** · sum insured **${usd(sumInsured)}** · written premium **${usd(premium)}** (rate on line ${pct(premium, sumInsured, 1)}).`,
    `- Products: ${[...byProduct.entries()].map(([p, x]) => `${p} ${x.n} (${usd(x.si)})`).join(" · ")}.`,
    `- **Parametric trigger watch** (72 h rain ≥ ${PARAMETRIC_TRIGGER_MM} mm): ${withRain.length ? `**${triggered.length}** plots would trigger on the current forecast${triggered.length ? ` (up to ${usd(trigSI)} sum insured)` : ""}; **${near.length}** are within 25 mm of the trigger. Highest forecast: ${closest[0] ? `**${closest[0].name}** at ${closest[0].rain72} mm` : "—"}.` : "live rainfall forecast unavailable right now."}`,
    `- **${num(atRisk.length)} plots (${pct(atRisk.length, rows.length)})** are at or above the at-risk threshold (${ws.riskThreshold}/100), carrying **${usd(siAtRisk)}** sum insured (${pct(siAtRisk, sumInsured)}).`,
    `_Rate on line = premium ÷ sum insured. “Would trigger” compares each parametric plot's 72 h forecast rainfall with the ${PARAMETRIC_TRIGGER_MM} mm trigger in your parametric product; it is a forecast signal, not a claim._`,
  ];
  return {
    data: { policies: rows.length, sumInsuredUsd: sumInsured, premiumUsd: premium, rateOnLinePct: sumInsured ? Math.round((premium / sumInsured) * 1000) / 10 : 0, products: Object.fromEntries(byProduct), parametric: { count: parametric.length, triggerMm: PARAMETRIC_TRIGGER_MM, wouldTrigger: triggered.length, wouldTriggerSumInsuredUsd: trigSI, within25mm: near.length, forecastAvailable: withRain.length > 0 }, atRisk: { count: atRisk.length, sumInsuredUsd: siAtRisk, threshold: ws.riskThreshold }, closestToTrigger: closest.slice(0, 5).map((r) => ({ name: r.name, ref: r.ref, rain72hMm: r.rain72 })) },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [{ label: "Policies", value: num(rows.length) }, { label: "Sum insured", value: usd(sumInsured) }, { label: "Premium", value: usd(premium), sub: `ROL ${pct(premium, sumInsured, 1)}` }, { label: "Would trigger", value: `${triggered.length}`, sub: `${near.length} within 25 mm`, tone: triggered.length ? "bad" : near.length ? "warn" : "good" }, { label: "SI at risk", value: usd(siAtRisk), sub: pct(siAtRisk, sumInsured), tone: siAtRisk ? "warn" : "good" }] },
      ...(closest.length ? [{ kind: "table" as const, title: `Parametric plots closest to the ${PARAMETRIC_TRIGGER_MM} mm trigger`, hrefKey: "href", note: "72 h forecast rainfall vs trigger", columns: [{ key: "name", label: "Plot" }, { key: "ref", label: "Policy" }, { key: "rain", label: "Rain 72h mm", align: "right" as const, format: "number" as const }, { key: "gap", label: "Gap to trigger mm", align: "right" as const, format: "number" as const }, { key: "si", label: "Sum insured", align: "right" as const, format: "money" as const }], rows: closest.map((r) => ({ name: r.name, ref: r.ref, rain: r.rain72, gap: Math.round((PARAMETRIC_TRIGGER_MM - (r.rain72 ?? 0)) * 10) / 10, si: r.valueUsd, href: r.href })) }] : []),
      { kind: "chart", title: "Sum insured by product (USD)", type: "bar", unit: "USD", series: [{ name: "Sum insured", data: [...byProduct.entries()].map(([p, x]) => ({ x: p, y: x.si })) }] },
    ],
    actions: [{ label: "Open Insurance module", href: LINKS.insurance(), kind: "module" }, { label: "Rule: 72 h rain ≥ 120 mm on parametric", href: LINKS.newRule({ metric: "rain_72h_mm", op: ">=", value: 120, tags: "parametric" }), kind: "rule" }],
    sources: wsSource(ws),
    followUps: ["Top 10 coastal plots by flood risk", "What is basis risk?", "Rain forecast for Satkhira next 3 days"],
  };
}

// ─── 11. Finance ──────────────────────────────────────────────────────────

async function financeStats(ctx: CopilotContext, args: Args): Promise<ToolOutput> {
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  let rows = ws.rows.filter((r) => r.type === "loan");
  if (str(args.country)) rows = applyFilter(rows, { country: str(args.country) });
  if (!rows.length) return empty(`${ws.orgName} has no agricultural loans in its portfolio, so there are no lending statistics to report.`);
  const out = rows.reduce((t, r) => t + r.valueUsd, 0);
  const principal = rows.reduce((t, r) => t + (typeof r.meta.principalUsd === "number" ? r.meta.principalUsd : 0), 0);
  const dpd = (r: Row) => (typeof r.meta.daysPastDue === "number" ? r.meta.daysPastDue : 0);
  const pastDue = rows.filter((r) => dpd(r) > 0);
  const dpd30 = rows.filter((r) => dpd(r) > 30);
  const dpd90 = rows.filter((r) => dpd(r) >= 90);
  const atRisk = rows.filter((r) => r.composite >= ws.riskThreshold);
  const outAtRisk = atRisk.reduce((t, r) => t + r.valueUsd, 0);
  const both = atRisk.filter((r) => dpd(r) > 0);
  const ratings = new Map<string, { n: number; out: number; avg: number }>();
  for (const r of rows) {
    const k = String(r.meta.internalRating ?? "NR");
    const x = ratings.get(k) ?? { n: 0, out: 0, avg: 0 };
    x.n++;
    x.out += r.valueUsd;
    x.avg += r.composite;
    ratings.set(k, x);
  }
  const order = ["A", "BBB", "BB", "B", "NR"];
  const noCollateral = rows.filter((r) => r.meta.collateral === "None");
  const lines = [
    `**${plural(rows.length, "agricultural loan", "agricultural loans")}** · outstanding **${usd(out)}** of ${usd(principal)} originated.`,
    `- Past due: **${pastDue.length}** loans (${usd(pastDue.reduce((t, r) => t + r.valueUsd, 0))}); > 30 days: ${dpd30.length}; ≥ 90 days (NPL): **${dpd90.length}** (${usd(dpd90.reduce((t, r) => t + r.valueUsd, 0))}).`,
    `- Climate: **${atRisk.length} loans (${pct(atRisk.length, rows.length)})** are at or above the at-risk threshold (${ws.riskThreshold}/100), **${usd(outAtRisk)}** outstanding (${pct(outAtRisk, out)} of the book).`,
    `- **${both.length}** loans are both climate-stressed and already past due — the first place to look for early restructuring.`,
    `- ${noCollateral.length} loans (${usd(noCollateral.reduce((t, r) => t + r.valueUsd, 0))}) have no collateral.`,
  ];
  return {
    data: { loans: rows.length, outstandingUsd: out, principalUsd: principal, pastDue: { count: pastDue.length, over30: dpd30.length, npl90: dpd90.length }, climate: { atRiskCount: atRisk.length, outstandingAtRiskUsd: outAtRisk, threshold: ws.riskThreshold, stressedAndPastDue: both.length }, ratings: Object.fromEntries(ratings), uncollateralised: noCollateral.length },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [{ label: "Loans", value: num(rows.length) }, { label: "Outstanding", value: usd(out) }, { label: "Past due", value: `${pastDue.length}`, sub: `${dpd90.length} ≥ 90 d`, tone: dpd90.length ? "bad" : pastDue.length ? "warn" : "good" }, { label: "Outstanding at climate risk", value: usd(outAtRisk), sub: pct(outAtRisk, out), tone: outAtRisk ? "warn" : "good" }, { label: "Stressed + past due", value: `${both.length}`, tone: both.length ? "bad" : "good" }] },
      { kind: "table", title: "By internal rating", columns: [{ key: "rating", label: "Rating" }, { key: "n", label: "Loans", align: "right", format: "number" }, { key: "out", label: "Outstanding", align: "right", format: "money" }, { key: "avg", label: "Avg climate score", align: "right", format: "score" }], rows: [...ratings.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([rating, x]) => ({ rating, n: x.n, out: x.out, avg: Math.round(x.avg / x.n) })) },
      ...(both.length ? [{ kind: "table" as const, title: "Climate-stressed loans already past due", hrefKey: "href", columns: [{ key: "name", label: "Loan" }, { key: "ref", label: "Account" }, { key: "dpd", label: "DPD", align: "right" as const, format: "number" as const }, { key: "composite", label: "Climate", align: "right" as const, format: "score" as const }, { key: "out", label: "Outstanding", align: "right" as const, format: "money" as const }], rows: both.sort((a, b) => dpd(b) - dpd(a)).slice(0, 10).map((r) => ({ name: r.name, ref: r.ref, dpd: dpd(r), composite: r.composite, out: r.valueUsd, href: r.href })) }] : []),
    ],
    actions: [{ label: "Open Lending & Finance", href: LINKS.finance(), kind: "module" }, { label: "Rule: loan composite > 70", href: LINKS.newRule({ metric: "composite", op: ">", value: 70, types: "loan" }), kind: "rule" }],
    sources: wsSource(ws),
    followUps: ["Which rice loans have the highest salinity risk?", "Compare Bến Tre and Cà Mau", "What is PD?"],
  };
}

// ─── 12. Anticipatory action ─────────────────────────────────────────────

async function anticipatoryStats(ctx: CopilotContext): Promise<ToolOutput> {
  const ws = await loadWorkspace(ctx.orgId, ctx.userId);
  const rows = ws.rows.filter((r) => r.type === "community");
  if (!rows.length) return empty(`${ws.orgName} has no communities in its portfolio, so there are no anticipatory-action figures to report.`);
  const hh = (r: Row) => (typeof r.meta.households === "number" ? r.meta.households : 0);
  const pop = (r: Row) => (typeof r.meta.population === "number" ? r.meta.population : 0);
  const TRIGGER = 50; // rule_005 readiness: 72 h flood probability > 50 %
  const flood = rows.filter((r) => r.flood > TRIGGER);
  const atRisk = rows.filter((r) => r.composite >= ws.riskThreshold);
  const target = rows.filter((r) => r.flood > TRIGGER || r.composite >= ws.riskThreshold);
  const sumHH = (rs: Row[]) => rs.reduce((t, r) => t + hh(r), 0);
  const cash = target.reduce((t, r) => t + r.valueUsd, 0);
  const farShelter = target.filter((r) => typeof r.meta.cycloneShelterKm === "number" && r.meta.cycloneShelterKm > 5);
  const sorted = [...target].sort((a, b) => b.flood - a.flood || b.composite - a.composite);
  const perHh = Array.from(new Set(rows.map((r) => (typeof r.meta.cashPerHouseholdUsd === "number" ? r.meta.cashPerHouseholdUsd : null)).filter((x): x is number => x != null)));
  const perHhLabel = perHh.length === 1 ? `USD ${perHh[0]}/household` : "the per-household transfer set for each community";
  const lines = [
    `**${plural(rows.length, "community", "communities")}** · **${num(sumHH(rows))} households** (~${num(rows.reduce((t, r) => t + pop(r), 0))} people) · total pre-arranged envelope **${usd(rows.reduce((t, r) => t + r.valueUsd, 0))}** at ${perHhLabel}.`,
    `- **${target.length}** communities meet a readiness condition now (72 h flood probability > ${TRIGGER}% **or** composite ≥ ${ws.riskThreshold}): **${num(sumHH(target))} households** → cash to pre-position **${usd(cash)}**.`,
    `  - by flood probability > ${TRIGGER}%: ${flood.length} communities (${num(sumHH(flood))} households); by composite ≥ ${ws.riskThreshold}: ${atRisk.length} (${num(sumHH(atRisk))} households).`,
    farShelter.length ? `- ${farShelter.length} of those ${farShelter.length === 1 ? "is" : "are"} more than 5 km from a cyclone shelter — prioritise evacuation support there.` : `- All targeted communities are within 5 km of a cyclone shelter.`,
    `_Cash = households × ${perHh.length === 1 ? `USD ${perHh[0]}` : "per-household transfer"} (your programme's pre-arranged envelope for each community). Conditions mirror your “Anticipatory action — flood readiness” rule._`,
  ];
  return {
    data: { communities: rows.length, households: sumHH(rows), cashPerHouseholdUsd: perHh.length === 1 ? perHh[0] : perHh, population: rows.reduce((t, r) => t + pop(r), 0), trigger: { floodProb72hAbove: TRIGGER, compositeAtLeast: ws.riskThreshold }, targeted: { communities: target.length, households: sumHH(target), cashUsd: cash, byFlood: flood.length, byComposite: atRisk.length, farFromShelter: farShelter.length }, top: sorted.slice(0, 5).map((r) => ({ name: r.name, flood: r.flood, composite: r.composite, households: hh(r) })) },
    markdown: lines.join("\n"),
    artifacts: [
      { kind: "kpis", items: [{ label: "Communities", value: num(rows.length) }, { label: "Households", value: num(sumHH(rows)) }, { label: "Meet readiness now", value: `${target.length}`, sub: `${num(sumHH(target))} households`, tone: target.length ? "warn" : "good" }, { label: "Cash to pre-position", value: usd(cash), tone: cash ? "warn" : "good" }] },
      ...(sorted.length ? [{ kind: "table" as const, title: "Communities meeting a readiness condition", hrefKey: "href", columns: [{ key: "name", label: "Community" }, { key: "flood", label: "Flood 72h %", align: "right" as const, format: "number" as const }, { key: "composite", label: "Composite", align: "right" as const, format: "score" as const }, { key: "hh", label: "Households", align: "right" as const, format: "number" as const }, { key: "cash", label: "Cash", align: "right" as const, format: "money" as const }, { key: "shelter", label: "Shelter km", align: "right" as const, format: "number" as const }], rows: sorted.slice(0, 15).map((r) => ({ name: r.name, flood: r.flood, composite: r.composite, hh: hh(r), cash: r.valueUsd, shelter: typeof r.meta.cycloneShelterKm === "number" ? r.meta.cycloneShelterKm : null, href: r.href })) }] : []),
      { kind: "map", title: "Communities", markers: markers([...rows].sort((a, b) => b.composite - a.composite)) },
    ],
    actions: [{ label: "Open Anticipatory Action", href: LINKS.anticipatory(), kind: "module" }, { label: "Rule: community flood > 50%", href: LINKS.newRule({ metric: "flood_prob_72h", op: ">", value: 50, types: "community" }), kind: "rule" }],
    sources: wsSource(ws),
    followUps: ["Any cyclones near our communities?", "Forecast for Satkhira next 3 days", "What is anticipatory action?"],
  };
}

// ─── Registry ─────────────────────────────────────────────────────────────

export const TOOLS: Record<ToolName, (ctx: CopilotContext, args: Args) => Promise<ToolOutput>> = {
  portfolio_summary: portfolioSummary,
  top_risk_assets: topRiskAssets,
  asset_detail: assetDetail,
  assess_location: assessLocationTool,
  forecast: forecastTool,
  compare_places: comparePlacesTool,
  alerts_and_rules: (ctx) => alertsAndRules(ctx),
  hazards_near_assets: hazardsNear,
  explain_metric: explainMetric,
  insurance_stats: insuranceStats,
  finance_stats: financeStats,
  anticipatory_stats: (ctx) => anticipatoryStats(ctx),
  situation_briefing: (ctx) => twinBriefingTool(ctx),
  yield_outlook: (ctx) => yieldOutlookTool(ctx),
  incidents_status: (ctx) => incidentsTool(ctx),
  sensors_status: (ctx) => sensorsTool(ctx),
};

/** JSON-schema tool definitions for OpenAI-compatible function calling. */
export const TOOL_SCHEMAS: { name: ToolName; description: string; parameters: Record<string, unknown> }[] = [
  { name: "portfolio_summary", description: "Summary of the caller's monitored portfolio: counts, total value, assets at risk, value at risk, risk mix, dominant hazard, 30-day trend. Optional filters.", parameters: { type: "object", properties: { country: { type: "string" }, types: { type: "array", items: { type: "string" } }, crop: { type: "string" }, tag: { type: "string", description: "e.g. coastal, parametric, sme" }, area: { type: "string", description: "district or village name" }, hazard: { type: "string", enum: ["flood", "salinity", "drought", "heat"] } } } },
  { name: "top_risk_assets", description: "Rank the caller's assets by a hazard score with optional filters and thresholds.", parameters: { type: "object", properties: { hazard: { type: "string", enum: ["flood", "salinity", "drought", "heat", "composite"] }, limit: { type: "integer", minimum: 1, maximum: 50 }, country: { type: "string" }, types: { type: "array", items: { type: "string" } }, crop: { type: "string" }, tag: { type: "string" }, area: { type: "string" }, level: { type: "string", enum: ["critical", "high", "medium", "low"] }, threshold: { type: "object", properties: { op: { type: "string", enum: [">", ">=", "<", "<="] }, value: { type: "number" }, unit: { type: "string", enum: ["%", "score", "mm", "dS/m"] } }, required: ["op", "value", "unit"] } } } },
  { name: "asset_detail", description: "Full detail for one asset by name, reference (policy/loan number) or id: scores, drivers, forecast rain, record fields, 30-day trend.", parameters: { type: "object", properties: { asset: { type: "string" } }, required: ["asset"] } },
  { name: "assess_location", description: "Climate-risk assessment for any place on Earth by name (geocoded): composite, flood probability, salinity EC, drought water balance, heat, river discharge, nearby hazard events.", parameters: { type: "object", properties: { place: { type: "string" }, focus: { type: "string", enum: ["flood", "salinity", "drought", "heat", "hazards"] } }, required: ["place"] } },
  { name: "forecast", description: "Daily weather forecast (rain, temperature, ET0) for a place name or one of the caller's assets. Omit both for the workspace's home region.", parameters: { type: "object", properties: { place: { type: "string" }, asset: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 16 } } } },
  { name: "compare_places", description: "Compare 2-4 places side by side on composite, flood, salinity, drought and heat.", parameters: { type: "object", properties: { places: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 }, hazard: { type: "string", enum: ["flood", "salinity", "drought", "heat", "composite"] } }, required: ["places"] } },
  { name: "alerts_and_rules", description: "The caller's alert rules (conditions, how often they fired), recent notifications and official early-warning alerts in their districts.", parameters: { type: "object", properties: {} } },
  { name: "hazards_near_assets", description: "Live GDACS / NASA EONET hazard events (cyclones, floods, storms…) within a radius of the caller's assets.", parameters: { type: "object", properties: { radiusKm: { type: "number" } } } },
  { name: "explain_metric", description: "Plain-language definition of a metric or term and how Agri-SHIELD computes it (composite, flood, ec, drought, heat, discharge, et0, spi, return_period, basis_risk, parametric, auc, expected_loss, pd, ndvi, anticipatory).", parameters: { type: "object", properties: { term: { type: "string" } }, required: ["term"] } },
  { name: "insurance_stats", description: "Insurance book statistics: policies, sum insured, premium, products, parametric plots near the rainfall trigger, sum insured at risk.", parameters: { type: "object", properties: { country: { type: "string" } } } },
  { name: "finance_stats", description: "Loan book statistics: outstanding, past due / NPL, outstanding at climate risk, loans both stressed and past due, rating mix.", parameters: { type: "object", properties: { country: { type: "string" } } } },
  { name: "anticipatory_stats", description: "Anticipatory-action figures for communities: households, population, communities meeting readiness triggers, cash to pre-position, shelter distance.", parameters: { type: "object", properties: {} } },
  { name: "situation_briefing", description: "What needs attention right now: workspace situation summary and the top ranked hotspots (assets, districts, cyclones, hazards) with links.", parameters: { type: "object", properties: {} } },
  { name: "yield_outlook", description: "In-season crop yield / production forecast for the caller's crop assets: P10/P50/P90 tonnes, % vs 5-year normal, main drivers, insurer payout outlook or bank repayment outlook.", parameters: { type: "object", properties: {} } },
  { name: "incidents_status", description: "Open incidents in the caller's workspace: severity, status, assets, tasks, SLA breaches, exposure.", parameters: { type: "object", properties: {} } },
  { name: "sensors_status", description: "IoT sensor fleet status: devices reporting/offline, real events detected in the last 24 h, sensor faults, low batteries, which devices need a field visit.", parameters: { type: "object", properties: {} } },
];

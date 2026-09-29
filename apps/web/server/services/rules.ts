/**
 * Alert-rule engine — pure, dependency-free evaluation (unit-tested in
 * tests/portfolio-rules.test.ts). Dispatch (notifications, e-mail, SMS,
 * webhooks, Slack) lives in services/portfolio.ts so this file never does I/O.
 *
 * A rule reads:  IF <metric> <op> <value> [AND|OR …]  FOR <scope>  THEN notify <channels>
 *
 *  - scope:      assetIds / tags (any-of) / types / countries — every criterion that is
 *                set must match (AND across criteria, OR within one list); empty = all assets
 *  - match:      "all" → every condition must pass; "any" → at least one
 *  - missing:    a metric with no data never passes (and is reported as "no data")
 *  - cooldown:   after a firing the rule stays quiet for `cooldownHours` (rule-level)
 */
import { createHmac } from "node:crypto";
import type { AlertRuleRecord, AssetAssessment, RuleMetric } from "../data/seed-assets";

export type RuleOp = AlertRuleRecord["conditions"][number]["op"];
export type RuleCondition = AlertRuleRecord["conditions"][number];
export type RuleScope = AlertRuleRecord["scope"];

export interface MetricMeta {
  label: string;
  short: string;
  unit: string;
  help: string;
  min: number;
  max: number;
  step: number;
  suggested: number;
}

/** Plain-language catalogue used by the rule builder, explanations and notifications. */
export const METRICS: Record<RuleMetric, MetricMeta> = {
  flood_prob_72h: { label: "Flood probability (next 72 h)", short: "Flood 72h", unit: "%", help: "Chance (0-100 %) that the site floods within 3 days, from forecast rain, soil saturation, river discharge and terrain.", min: 0, max: 100, step: 1, suggested: 60 },
  flood_prob_24h: { label: "Flood probability (next 24 h)", short: "Flood 24h", unit: "%", help: "Chance (0-100 %) of flooding within the next day — use for last-minute evacuation / harvest decisions.", min: 0, max: 100, step: 1, suggested: 40 },
  salinity_ec: { label: "Soil salinity (EC)", short: "Salinity", unit: "dS/m", help: "Electrical conductivity of soil water in deci-Siemens per metre. Rice starts losing yield above ~3 dS/m; above 8 most crops fail.", min: 0, max: 20, step: 0.1, suggested: 4 },
  composite: { label: "Composite climate risk score", short: "Composite", unit: "/100", help: "One 0-100 number combining flood, salinity, drought and heat. 35+ medium, 60+ high, 80+ critical.", min: 0, max: 100, step: 1, suggested: 60 },
  rain_24h_mm: { label: "Rain forecast (next 24 h)", short: "Rain 24h", unit: "mm", help: "Total forecast rainfall over the next 24 hours (Open-Meteo). 50 mm+ in a day is very heavy rain.", min: 0, max: 400, step: 1, suggested: 50 },
  rain_72h_mm: { label: "Rain forecast (next 72 h)", short: "Rain 72h", unit: "mm", help: "Total forecast rainfall over the next 3 days — the usual window for parametric rainfall triggers.", min: 0, max: 600, step: 1, suggested: 120 },
  drought_risk: { label: "Drought risk score", short: "Drought", unit: "/100", help: "How far evaporation will exceed rainfall over the next week (FAO-56 water balance), as 0-100.", min: 0, max: 100, step: 1, suggested: 50 },
  heat_risk: { label: "Heat-stress risk score", short: "Heat", unit: "/100", help: "Crop heat stress from the forecast maximum temperature (0 at 32 °C, 100 at 42 °C+).", min: 0, max: 100, step: 1, suggested: 50 },
  river_discharge_ratio: { label: "River discharge vs normal", short: "River", unit: "×", help: "Forecast peak river flow divided by the 30-day average (GloFAS). 1.5× means 50 % above normal; 2× often means overbank flooding.", min: 0, max: 10, step: 0.1, suggested: 1.5 },
};

export const RULE_METRICS = Object.keys(METRICS) as RuleMetric[];

export const OP_LABEL: Record<RuleOp, string> = { ">": "is above", ">=": "is at least", "<": "is below", "<=": "is at most" };

export type MetricSnapshot = Record<RuleMetric, number | null>;

/** Rich metrics produced by assessMany (QuickAssessment subset). */
export interface QuickMetrics {
  floodRisk: number;
  floodProb24h: number;
  salinityRisk: number;
  salinityEc: number;
  droughtRisk: number;
  heatRisk: number;
  composite: number;
  rain24hMm: number;
  rain72hMm: number;
  dischargeRatio: number | null;
  source?: string;
}

/**
 * Build the metric vector for one asset. Prefers the full quick assessment;
 * falls back to the stored AssetAssessment (EC derived from the salinity
 * score, rain/discharge unknown → null).
 */
export function snapshotFrom(q: QuickMetrics | null | undefined, a: Pick<AssetAssessment, "floodRisk" | "salinityRisk" | "droughtRisk" | "heatRisk" | "composite"> | null | undefined): MetricSnapshot {
  if (q) {
    const live = q.source !== "fallback";
    return {
      flood_prob_72h: q.floodRisk,
      flood_prob_24h: Math.round(q.floodProb24h * 1000) / 10,
      salinity_ec: q.salinityEc,
      composite: q.composite,
      // Fallback (no live feed) rain values are district baselines, not forecasts — treat as unknown
      rain_24h_mm: live ? q.rain24hMm : null,
      rain_72h_mm: live ? q.rain72hMm : null,
      drought_risk: q.droughtRisk,
      heat_risk: q.heatRisk,
      river_discharge_ratio: q.dischargeRatio,
    };
  }
  if (a) {
    return {
      flood_prob_72h: a.floodRisk,
      flood_prob_24h: null,
      salinity_ec: Math.round(((a.salinityRisk / 100) * 9) * 10) / 10,
      composite: a.composite,
      rain_24h_mm: null,
      rain_72h_mm: null,
      drought_risk: a.droughtRisk,
      heat_risk: a.heatRisk,
      river_discharge_ratio: null,
    };
  }
  return { flood_prob_72h: null, flood_prob_24h: null, salinity_ec: null, composite: null, rain_24h_mm: null, rain_72h_mm: null, drought_risk: null, heat_risk: null, river_discharge_ratio: null };
}

export interface ScopedAsset {
  id: string;
  name: string;
  type: string;
  tags: string[];
  country: string;
  status?: string;
}

export function inScope(scope: RuleScope | null | undefined, a: ScopedAsset): boolean {
  if (a.status && a.status !== "active") return false;
  if (!scope) return true;
  if (scope.assetIds?.length && !scope.assetIds.includes(a.id)) return false;
  if (scope.tags?.length) {
    const tags = new Set(a.tags.map((t) => t.toLowerCase()));
    if (!scope.tags.some((t) => tags.has(t.toLowerCase()))) return false;
  }
  if (scope.types?.length && !(scope.types as string[]).includes(a.type)) return false;
  if (scope.countries?.length && !scope.countries.some((c) => c.toLowerCase() === a.country.toLowerCase())) return false;
  return true;
}

export function compare(actual: number, op: RuleOp, value: number): boolean {
  switch (op) {
    case ">":
      return actual > value;
    case ">=":
      return actual >= value;
    case "<":
      return actual < value;
    case "<=":
      return actual <= value;
  }
}

export interface ConditionResult {
  metric: RuleMetric;
  op: RuleOp;
  value: number;
  actual: number | null;
  pass: boolean;
}

export function evaluateConditions(rule: Pick<AlertRuleRecord, "conditions" | "match">, snap: MetricSnapshot): { matched: boolean; results: ConditionResult[] } {
  const results = rule.conditions.map((c) => {
    const actual = snap[c.metric];
    return { metric: c.metric, op: c.op, value: c.value, actual, pass: actual != null && Number.isFinite(actual) && compare(actual, c.op, c.value) };
  });
  if (!results.length) return { matched: false, results };
  const matched = rule.match === "any" ? results.some((r) => r.pass) : results.every((r) => r.pass);
  return { matched, results };
}

export function fmtMetric(metric: RuleMetric, v: number | null): string {
  if (v == null) return "no data";
  const m = METRICS[metric];
  const n = m.step < 1 ? v.toFixed(1) : Math.round(v).toString();
  return m.unit === "%" ? `${n}%` : m.unit === "×" ? `${n}×` : m.unit.startsWith("/") ? `${n}${m.unit}` : `${n} ${m.unit}`;
}

/** "Flood 72h 64% > 60%; Rain 72h 131 mm ≥ 120 mm" — only the passing conditions (all if none pass). */
export function explainResults(results: ConditionResult[]): string {
  const shown = results.some((r) => r.pass) ? results.filter((r) => r.pass) : results;
  return shown.map((r) => `${METRICS[r.metric].short} ${fmtMetric(r.metric, r.actual)} ${r.op === ">=" ? "≥" : r.op === "<=" ? "≤" : r.op} ${fmtMetric(r.metric, r.value)}`).join("; ");
}

export function describeConditions(rule: Pick<AlertRuleRecord, "conditions" | "match">): string {
  return rule.conditions.map((c) => `${METRICS[c.metric].label.toLowerCase()} ${OP_LABEL[c.op]} ${fmtMetric(c.metric, c.value)}`).join(rule.match === "any" ? " OR " : " AND ");
}

export function describeScope(scope: RuleScope): string {
  const parts: string[] = [];
  if (scope.assetIds?.length) parts.push(`${scope.assetIds.length} selected asset${scope.assetIds.length === 1 ? "" : "s"}`);
  if (scope.tags?.length) parts.push(`tagged ${scope.tags.join(" / ")}`);
  if (scope.types?.length) parts.push(`of type ${scope.types.map((t) => t.replace(/_/g, " ")).join(" / ")}`);
  if (scope.countries?.length) parts.push(`in ${scope.countries.join(" / ")}`);
  return parts.length ? `assets ${parts.join(", ")}` : "every active asset";
}

/** One-sentence plain-language description of a rule. */
export function describeRule(rule: Pick<AlertRuleRecord, "conditions" | "match" | "scope" | "channels" | "cooldownHours">): string {
  return `If ${describeConditions(rule)} for ${describeScope(rule.scope)}, notify via ${rule.channels.join(", ")} (then wait ${rule.cooldownHours} h before repeating).`;
}

export function cooldownUntil(rule: Pick<AlertRuleRecord, "lastTriggeredAt" | "cooldownHours">): Date | null {
  if (!rule.lastTriggeredAt || rule.cooldownHours <= 0) return null;
  return new Date(new Date(rule.lastTriggeredAt).getTime() + rule.cooldownHours * 3_600_000);
}

export function isCoolingDown(rule: Pick<AlertRuleRecord, "lastTriggeredAt" | "cooldownHours">, now = new Date()): boolean {
  const until = cooldownUntil(rule);
  return !!until && until.getTime() > now.getTime();
}

export interface RuleMatch {
  assetId: string;
  name: string;
  results: ConditionResult[];
  reason: string;
}

export interface RuleEvaluation {
  ruleId: string;
  inScope: number;
  withData: number;
  matches: RuleMatch[];
  /** true when the rule would dispatch right now */
  fires: boolean;
  blockedBy: "disabled" | "cooldown" | "no-match" | null;
  cooldownUntil: Date | null;
}

export function evaluateRule(
  rule: Pick<AlertRuleRecord, "id" | "enabled" | "scope" | "conditions" | "match" | "lastTriggeredAt" | "cooldownHours">,
  assets: ScopedAsset[],
  snapshots: Map<string, MetricSnapshot> | Record<string, MetricSnapshot>,
  opts: { now?: Date; ignoreCooldown?: boolean; ignoreEnabled?: boolean } = {}
): RuleEvaluation {
  const get = (id: string) => (snapshots instanceof Map ? snapshots.get(id) : snapshots[id]);
  const scoped = assets.filter((a) => inScope(rule.scope, a));
  const matches: RuleMatch[] = [];
  let withData = 0;
  for (const a of scoped) {
    const snap = get(a.id);
    if (!snap) continue;
    withData++;
    const { matched, results } = evaluateConditions(rule, snap);
    if (matched) matches.push({ assetId: a.id, name: a.name, results, reason: explainResults(results) });
  }
  // Worst first: sort by the first condition's distance past its threshold
  const c0 = rule.conditions[0];
  if (c0) {
    const dir = c0.op === "<" || c0.op === "<=" ? -1 : 1;
    matches.sort((x, y) => dir * ((y.results[0]?.actual ?? -Infinity) - (x.results[0]?.actual ?? -Infinity)));
  }
  const now = opts.now ?? new Date();
  const cooling = !opts.ignoreCooldown && isCoolingDown(rule, now);
  const blockedBy = !opts.ignoreEnabled && !rule.enabled ? "disabled" : !matches.length ? "no-match" : cooling ? "cooldown" : null;
  return { ruleId: rule.id, inScope: scoped.length, withData, matches, fires: blockedBy === null, blockedBy, cooldownUntil: cooldownUntil(rule) };
}

// ─── Outbound payloads ────────────────────────────────────────────────────

export interface FiringPayload {
  event: "rule.fired";
  firingId: string;
  workspaceId: string;
  rule: { id: string; name: string; severity: string; description: string };
  firedAt: string;
  matchCount: number;
  matches: { assetId: string; name: string; reason: string; metrics: Partial<Record<RuleMetric, number | null>> }[];
  link: string;
}

export function webhookPayload(input: Omit<FiringPayload, "event">): FiringPayload {
  return { event: "rule.fired", ...input };
}

/** GitHub-style signature header value: `sha256=<hex hmac of raw body>`. */
export function signWebhook(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Slack incoming-webhook message (Block Kit) for a firing. */
export function slackMessage(p: FiringPayload) {
  const emoji = p.rule.severity === "critical" ? ":rotating_light:" : p.rule.severity === "warning" ? ":warning:" : ":information_source:";
  const lines = p.matches.slice(0, 8).map((m) => `• *${m.name}* — ${m.reason}`);
  if (p.matchCount > 8) lines.push(`…and ${p.matchCount - 8} more`);
  const text = `${emoji} Agri-SHIELD rule fired: ${p.rule.name} (${p.matchCount} asset${p.matchCount === 1 ? "" : "s"})`;
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${p.rule.name}`.slice(0, 150) } },
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *${p.rule.severity.toUpperCase()}* · ${p.matchCount} asset${p.matchCount === 1 ? "" : "s"} matched\n${p.rule.description}` } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") || "_no assets_" } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in Agri-SHIELD" }, url: p.link }] },
    ],
  };
}

/** Short SMS/WhatsApp text (≤ 320 chars). */
export function smsText(p: Pick<FiringPayload, "rule" | "matchCount" | "matches">): string {
  const first = p.matches[0];
  const s = `Agri-SHIELD ${p.rule.severity.toUpperCase()}: ${p.rule.name} — ${p.matchCount} asset${p.matchCount === 1 ? "" : "s"}${first ? `, e.g. ${first.name} (${first.reason})` : ""}.`;
  return s.length > 320 ? `${s.slice(0, 317)}…` : s;
}

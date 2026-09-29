/**
 * Agri-SHIELD Copilot — shared contract between the planner, the tools and the UI.
 * Everything a Copilot answer shows is derived from tool outputs (never invented).
 */

export type Hazard = "flood" | "salinity" | "drought" | "heat" | "composite";

export type ToolName =
  | "portfolio_summary"
  | "top_risk_assets"
  | "asset_detail"
  | "assess_location"
  | "forecast"
  | "compare_places"
  | "alerts_and_rules"
  | "hazards_near_assets"
  | "explain_metric"
  | "insurance_stats"
  | "finance_stats"
  | "anticipatory_stats";

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

// ─── Artifacts the UI renders ────────────────────────────────────────────

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "critical";
}

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Render hint: score → coloured 0-100 badge, level → risk pill, money → USD */
  format?: "text" | "score" | "level" | "money" | "number" | "percent";
}

export interface MapMarker {
  lat: number;
  lon: number;
  label: string;
  score?: number;
  href?: string;
  kind?: "asset" | "place" | "hazard";
}

export interface ChartSeries {
  name: string;
  color?: string;
  data: { x: string; y: number | null }[];
}

export type Artifact =
  | { kind: "kpis"; title?: string; items: KpiItem[] }
  | { kind: "table"; title?: string; columns: TableColumn[]; rows: Record<string, string | number | null>[]; hrefKey?: string; note?: string }
  | { kind: "map"; title?: string; markers: MapMarker[] }
  | { kind: "chart"; title?: string; type: "line" | "bar"; unit?: string; series: ChartSeries[] };

export interface CopilotAction {
  label: string;
  href: string;
  kind: "asset" | "rule" | "explorer" | "portfolio" | "alerts" | "module";
}

export interface ToolOutput {
  /** Compact JSON facts for an LLM planner (and for tests / audits). */
  data: Record<string, unknown>;
  /** Deterministic markdown built only from `data`. */
  markdown: string;
  artifacts: Artifact[];
  actions: CopilotAction[];
  sources: string[];
  followUps?: string[];
  /** Tool could not answer (e.g. place not found) — the planner must say so. */
  notFound?: string;
}

export interface CopilotAnswer {
  id: string;
  question: string;
  markdown: string;
  artifacts: Artifact[];
  actions: CopilotAction[];
  followUps: string[];
  sources: string[];
  toolsUsed: { tool: ToolName; args: Record<string, unknown>; ms: number; ok: boolean }[];
  planner: "rules" | "openai" | "groq" | "ollama";
  intent: string;
  createdAt: string;
  ms: number;
}

export interface CopilotContext {
  orgId: string;
  userId: string;
  userName: string;
  industry: import("@agri-shield/types").Industry;
  orgName: string;
}

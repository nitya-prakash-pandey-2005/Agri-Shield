/**
 * Supply-chain portal visual tokens + formatters.
 * Commodity identity colours use a fixed, CVD-validated categorical order
 * (dark-surface steps); risk uses the shared status colours (riskColor).
 */
export const NAVY = "#0b1a33";
export const NAVY_2 = "#10244a";
export const AMBER = "#f59e0b";
export const AMBER_SOFT = "#fbbf24";

/** Fixed order = store commodity order. Colour follows the entity, never its rank. */
export const COMMODITY_ORDER = ["rice", "wheat", "jute", "sugarcane", "coconut", "vegetables", "onion", "maize"] as const;
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const commodityColor = (c: string) => {
  const i = COMMODITY_ORDER.indexOf(c as (typeof COMMODITY_ORDER)[number]);
  return i >= 0 ? SLOTS[i]! : "#94a3b8";
};

export const INK = { primary: "#e2e8f0", secondary: "#94a3b8", muted: "#64748b", grid: "rgba(148,163,184,0.12)", axis: "rgba(148,163,184,0.35)" };

export function fmtUsd(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : digits)}K`;
  return `${sign}$${Math.round(a)}`;
}

export function fmtT(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} Mt`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)} kt`;
  return `${Math.round(v).toLocaleString("en-US")} t`;
}

export const fmtPct = (v: number | null | undefined, digits = 1, signed = false) =>
  v == null || !Number.isFinite(v) ? "—" : `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

export function timeAgo(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const NODE_TYPE_LABEL: Record<string, string> = { warehouse: "Warehouse", port: "Port", processor: "Processor", retailer: "Wholesale", region: "Farmland", buyer: "Buyer", producer: "Producers" };

/** Inline SVG glyphs for map pins (Leaflet divIcons can't render React). */
export function nodeGlyph(type: string, color: string, size: number, owned: boolean): string {
  const s = size;
  const fill = owned ? color : "rgba(6,10,22,0.9)";
  const stroke = owned ? "rgba(6,10,22,0.9)" : color;
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="2"`;
  const h = s / 2;
  switch (type) {
    case "port": // anchor-diamond
      return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect x="${h * 0.3}" y="${h * 0.3}" width="${s - h * 0.6}" height="${s - h * 0.6}" transform="rotate(45 ${h} ${h})" rx="2" ${common}/></svg>`;
    case "processor": {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${h + (h - 2) * Math.cos(a)},${h + (h - 2) * Math.sin(a)}`;
      }).join(" ");
      return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${pts}" ${common}/></svg>`;
    }
    case "retailer":
      return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${h},2 ${s - 2},${s - 3} 2,${s - 3}" ${common}/></svg>`;
    default: // warehouse: rounded square
      return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect x="2" y="2" width="${s - 4}" height="${s - 4}" rx="3" ${common}/></svg>`;
  }
}

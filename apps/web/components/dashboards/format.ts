/** Value formatting for dashboard widgets (by catalogue unit). */
import type { Unit } from "./catalog";
import { fmtUsd } from "@/components/portfolio/format";

export function fmtValue(v: number | null | undefined, unit: Unit, compact = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "usd":
      return fmtUsd(v, compact);
    case "pct":
      return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
    case "score":
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    case "ratio":
      return `${v.toFixed(2)}×`;
    default:
      return Math.round(v).toLocaleString("en-US");
  }
}

export function fmtDelta(v: number | null | undefined, unit: Unit): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "no change";
  const sign = v > 0 ? "+" : "−";
  const a = Math.abs(v);
  const body = unit === "usd" ? fmtUsd(a) : unit === "pct" ? `${a.toFixed(1)} pts` : unit === "score" ? a.toFixed(Number.isInteger(a) ? 0 : 1) : Math.round(a).toLocaleString("en-US");
  return `${sign}${body}`;
}

export const shortDate = (iso: string) => new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
export const weekday = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function ago(d: string | Date): string {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

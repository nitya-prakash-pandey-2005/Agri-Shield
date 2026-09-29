/**
 * Locale-aware formatting helpers (Intl.NumberFormat / DateTimeFormat /
 * RelativeTimeFormat). Pure functions — usable on server and client.
 */
import { currencyForCountry, localeMeta, type Locale, type Messages } from "./config";

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: Locale, opts: Intl.NumberFormatOptions = {}) {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(localeMeta(locale).intl, opts);
    } catch {
      f = new Intl.NumberFormat("en-GB", opts);
    }
    nfCache.set(key, f);
  }
  return f;
}

export function formatNumber(locale: Locale, value: number, opts?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) return "—";
  return nf(locale, opts).format(value);
}

export function formatPercent(locale: Locale, fraction0to1: number, digits = 0): string {
  return formatNumber(locale, fraction0to1, { style: "percent", maximumFractionDigits: digits });
}

/** Currency picked from the farmer's country: ₹ India, ৳ Bangladesh, ₫ Vietnam, ₱ Philippines, Rp Indonesia. */
export function formatCurrency(locale: Locale, amount: number, country?: string | null, currency?: string): string {
  const cur = currency ?? currencyForCountry(country);
  return formatNumber(locale, amount, { style: "currency", currency: cur, maximumFractionDigits: cur === "VND" || cur === "IDR" ? 0 : 2, minimumFractionDigits: 0 });
}

export function formatDate(locale: Locale, d: Date | string | number, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(localeMeta(locale).intl, opts).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", opts).format(date);
  }
}

export function formatTime(locale: Locale, d: Date | string | number): string {
  return formatDate(locale, d, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(locale: Locale, d: Date | string | number): string {
  return formatDate(locale, d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(locale: Locale, d: Date | string | number): string {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(localeMeta(locale).intl, { numeric: "auto" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  }
  const a = Math.abs(diff);
  if (a < 60) return rtf.format(Math.round(diff), "second");
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 86400 * 45) return rtf.format(Math.round(diff / 86400), "day");
  return rtf.format(Math.round(diff / (86400 * 30)), "month");
}

/** Compact duration like "2d 4h" / "3h 12m" using locale digits. */
export function formatDuration(locale: Locale, ms: number): string {
  if (ms <= 0) return formatNumber(locale, 0) + "m";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const n = (v: number) => formatNumber(locale, v);
  if (d > 0) return `${n(d)}d ${n(h % 24)}h`;
  if (h > 0) return `${n(h)}h ${n(m % 60)}m`;
  return `${n(m)}m`;
}

// ─── Message lookup + interpolation ────────────────────────────────────────

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Leaves<T> = T extends string ? never : { [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T & string];

/** Every dotted key in the English bundle, e.g. "home.riskStatus". */
export type MessageKey = Leaves<Messages>;
export type TVars = Record<string, string | number>;

export function lookup(messages: Messages, fallback: Messages, key: string): string {
  const get = (m: unknown) =>
    key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), m);
  const v = get(messages);
  if (typeof v === "string") return v;
  const f = get(fallback);
  return typeof f === "string" ? f : key;
}

export function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

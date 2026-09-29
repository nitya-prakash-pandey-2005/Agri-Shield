/**
 * Live FX rates (units per 1 USD) from the free ExchangeRate-API open endpoint
 * (https://open.er-api.com/v6/latest/USD — "Rates by Exchange Rate API"),
 * cached for 12 h, with the committed snapshot `server/data/real/fx-snapshot.json`
 * as the always-available fallback.
 *
 * `toUsd` / `fromUsd` are synchronous so they can be used anywhere (seed, pure
 * helpers, React server components): they read the freshest table held in
 * memory and, when that table is older than 12 h, trigger a background refresh.
 * Call `refreshFx()` (async) when a request must wait for live rates.
 */
import snapshot from "../data/real/fx-snapshot.json";
import { OFFLINE, cached, fetchJson } from "./http";

const TTL_MS = 12 * 3_600_000;
const URL = "https://open.er-api.com/v6/latest/USD";

export interface FxTable {
  base: "USD";
  /** ISO timestamp the provider last updated the rates */
  asOf: string;
  source: string;
  /** true when the table came from the live API during this process's lifetime */
  live: boolean;
  fetchedAt: string | null;
  rates: Record<string, number>;
}

const SNAPSHOT: FxTable = {
  base: "USD",
  asOf: new Date(snapshot.asOfUnix * 1000).toISOString(),
  source: snapshot.source,
  live: false,
  fetchedAt: null,
  rates: snapshot.rates as Record<string, number>,
};

const g = globalThis as unknown as { __agriFx?: { table: FxTable; at: number } };

function current(): FxTable {
  return g.__agriFx?.table ?? SNAPSHOT;
}

interface ErApiResponse {
  result: string;
  time_last_update_unix: number;
  rates: Record<string, number>;
}

/** Fetch live rates (cached 12 h; stale-while-error). Never throws — falls back to the snapshot. */
export async function refreshFx(): Promise<FxTable> {
  if (OFFLINE) return current();
  try {
    const table = await cached("fx:usd", TTL_MS, async () => {
      const d = await fetchJson<ErApiResponse>(URL, 8000);
      if (d.result !== "success" || !d.rates?.USD) throw new Error("fx: bad payload");
      const t: FxTable = {
        base: "USD",
        asOf: new Date(d.time_last_update_unix * 1000).toISOString(),
        source: "ExchangeRate-API (open.er-api.com) — live",
        live: true,
        fetchedAt: new Date().toISOString(),
        rates: d.rates,
      };
      return t;
    });
    g.__agriFx = { table, at: Date.now() };
    return table;
  } catch {
    return current();
  }
}

function maybeRefresh() {
  const at = g.__agriFx?.at ?? 0;
  if (Date.now() - at > TTL_MS && !OFFLINE && process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    g.__agriFx = { table: current(), at: Date.now() }; // debounce: one refresh per TTL window
    void refreshFx();
  }
}

/** Units of `ccy` per 1 USD (1 for USD). Throws on an unknown currency code. */
export function rateOf(ccy: string): number {
  const code = ccy.trim().toUpperCase();
  if (code === "USD") return 1;
  maybeRefresh();
  const r = current().rates[code] ?? SNAPSHOT.rates[code];
  if (!r || !Number.isFinite(r) || r <= 0) throw new Error(`Unknown currency: ${ccy}`);
  return r;
}

/** Convert an amount in `ccy` to USD. */
export function toUsd(amount: number, ccy: string): number {
  return amount / rateOf(ccy);
}

/** Convert a USD amount to `ccy`. */
export function fromUsd(usd: number, ccy: string): number {
  return usd * rateOf(ccy);
}

/** The table currently in use (live if refreshed within 12 h, else the committed snapshot). */
export function fxSnapshot(): FxTable {
  return current();
}

/** The committed snapshot only (deterministic — used by the demo seed). */
export function committedFx(): FxTable {
  return SNAPSHOT;
}

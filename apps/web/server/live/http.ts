/**
 * Tiny resilient fetch + TTL cache for free open-data APIs.
 * - every call has a hard timeout
 * - concurrent identical requests share one in-flight promise
 * - stale values are served if a refresh fails (stale-while-error)
 */
interface Entry<T> {
  value: T;
  expires: number;
}

const g = globalThis as unknown as {
  __agriCache?: Map<string, Entry<unknown>>;
  __agriInflight?: Map<string, Promise<unknown>>;
};
const cache: Map<string, Entry<unknown>> = (g.__agriCache ??= new Map());
const inflight: Map<string, Promise<unknown>> = (g.__agriInflight ??= new Map());

export const OFFLINE = process.env.AGRI_OFFLINE === "true";

// ─── Upstream quota protection ────────────────────────────────────────────
// Free open-data APIs meter per location and per hour. When a host answers
// 429 we stop calling it until its window resets (serving cached data), and
// production deployments can route Open-Meteo through the commercial tier.

const gb = globalThis as unknown as { __agriHostBlocks?: Map<string, number> };
const hostBlocks: Map<string, number> = (gb.__agriHostBlocks ??= new Map());

export class UpstreamRateLimited extends Error {
  constructor(public host: string, public until: number) {
    super(`${host} rate limit reached — retry after ${new Date(until).toISOString()}`);
  }
}

/** Hosts currently cooling down after a 429, for health/status pages. */
export function rateLimitedHosts(): { host: string; until: Date }[] {
  const now = Date.now();
  return [...hostBlocks.entries()].filter(([, t]) => t > now).map(([host, t]) => ({ host, until: new Date(t) }));
}

/** Open-Meteo commercial tier: same API on customer-* hosts with &apikey=. */
export function withProviderKeys(url: string): string {
  const key = process.env.OPEN_METEO_API_KEY;
  if (!key) return url;
  const u = new URL(url);
  if (!u.hostname.endsWith("open-meteo.com") || u.hostname.startsWith("customer-")) return url;
  u.hostname = `customer-${u.hostname}`;
  u.searchParams.set("apikey", key);
  return u.toString();
}

export async function fetchJson<T>(url: string, timeoutMs = 8000, init?: RequestInit): Promise<T> {
  if (OFFLINE) throw new Error("offline mode");
  const target = withProviderKeys(url);
  const host = new URL(target).hostname;
  const blockedUntil = hostBlocks.get(host);
  if (blockedUntil && blockedUntil > Date.now()) throw new UpstreamRateLimited(host, blockedUntil);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": "Agri-SHIELD/1.0 (climate early-warning research)", Accept: "application/json", ...init?.headers },
      cache: "no-store",
    });
    if (res.status === 429) {
      // Honour Retry-After when given; otherwise wait for the next full hour (Open-Meteo's window)
      const ra = Number(res.headers.get("retry-after"));
      const until = Number.isFinite(ra) && ra > 0 ? Date.now() + ra * 1000 : new Date().setMinutes(60, 30, 0);
      hostBlocks.set(host, until);
      console.warn(`[upstream] ${host} returned 429 — pausing calls until ${new Date(until).toISOString()}`);
      throw new UpstreamRateLimited(host, until);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Memoise an async loader for `ttlMs`; on failure return the last good value if any. */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = loader()
    .then((value) => {
      cache.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      if (hit) return hit.value; // stale-while-error
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function cacheStats() {
  return { entries: cache.size, inflight: inflight.size };
}

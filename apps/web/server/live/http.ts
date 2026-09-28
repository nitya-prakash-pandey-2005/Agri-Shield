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

export async function fetchJson<T>(url: string, timeoutMs = 8000, init?: RequestInit): Promise<T> {
  if (OFFLINE) throw new Error("offline mode");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": "Agri-SHIELD/1.0 (climate early-warning research)", Accept: "application/json", ...init?.headers },
      cache: "no-store",
    });
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

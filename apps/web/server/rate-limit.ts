/**
 * Sliding-window rate limiter (per minute). In-memory by default;
 * swap for Upstash Redis in multi-instance deployments (REDIS_URL).
 */
const g = globalThis as unknown as { __agriRL?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__agriRL ??= new Map());

export function rateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= limitPerMinute) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

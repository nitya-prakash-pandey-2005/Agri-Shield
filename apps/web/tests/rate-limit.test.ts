import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/server/rate-limit";

describe("sliding-window rate limiter", () => {
  afterEach(() => vi.useRealTimers());

  it("allows exactly N requests per minute per key", () => {
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 100; i++) expect(rateLimit(key, 100)).toBe(true);
    expect(rateLimit(key, 100)).toBe(false);
  });

  it("isolates keys", () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    for (let i = 0; i < 3; i++) rateLimit(a, 3);
    expect(rateLimit(a, 3)).toBe(false);
    expect(rateLimit(b, 3)).toBe(true);
  });

  it("slides: capacity returns after 60 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T00:00:00Z"));
    const key = `s:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5)).toBe(true);
    expect(rateLimit(key, 5)).toBe(false);
    vi.setSystemTime(new Date("2026-09-29T00:00:30Z"));
    expect(rateLimit(key, 5)).toBe(false);
    vi.setSystemTime(new Date("2026-09-29T00:01:00.001Z"));
    expect(rateLimit(key, 5)).toBe(true);
  });

  it("rejected requests do not extend the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T01:00:00Z"));
    const key = `r:${Math.random()}`;
    rateLimit(key, 1);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(5_000);
      expect(rateLimit(key, 1)).toBe(false);
    }
    vi.advanceTimersByTime(10_001);
    expect(rateLimit(key, 1)).toBe(true);
  });
});

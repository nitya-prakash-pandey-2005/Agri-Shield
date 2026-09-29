/**
 * Workspace IP allow-list: IPv4 / IPv6 addresses and CIDR ranges.
 * Enforced for every signed-in tRPC call of a workspace member (server/trpc.ts).
 * The client IP comes from X-Forwarded-For as set by the platform's trusted
 * reverse proxy; direct local connections are treated as 127.0.0.1 / ::1.
 */
import { policyFor } from "./security-state";

type Parsed = { v: 4 | 6; big: bigint };

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const x = Number(p);
    if (x > 255) return null;
    n = (n << BigInt(8)) | BigInt(x);
  }
  return n;
}

function parseV6(s: string): bigint | null {
  let str = s.toLowerCase();
  const zone = str.indexOf("%");
  if (zone >= 0) str = str.slice(0, zone);
  // IPv4 tail (e.g. ::ffff:10.0.0.1)
  const v4tail = str.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    const v4 = parseV4(v4tail[2]!);
    if (v4 === null) return null;
    str = `${v4tail[1]}${((v4 >> BigInt(16)) & BigInt(0xffff)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

export function parseIp(raw: string): Parsed | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === "local" || s === "localhost") return { v: 4, big: parseV4("127.0.0.1")! };
  const v4 = parseV4(s);
  if (v4 !== null) return { v: 4, big: v4 };
  const v6 = parseV6(s);
  if (v6 === null) return null;
  // IPv4-mapped IPv6 → IPv4
  if (v6 >> BigInt(32) === BigInt(0xffff)) return { v: 4, big: v6 & BigInt(0xffffffff) };
  return { v: 6, big: v6 };
}

export interface CidrRange {
  v: 4 | 6;
  base: bigint;
  prefix: number;
}

export function parseCidr(raw: string): CidrRange | null {
  const [addr, pfx, extra] = raw.trim().split("/");
  if (extra !== undefined || !addr) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const prefix = pfx === undefined ? max : /^\d{1,3}$/.test(pfx) ? Number(pfx) : NaN;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  const mask = prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(prefix)) - BigInt(1)) << BigInt(max - prefix);
  return { v: ip.v, base: ip.big & mask, prefix };
}

export function cidrContains(range: CidrRange, ipRaw: string): boolean {
  const ip = parseIp(ipRaw);
  if (!ip || ip.v !== range.v) return false;
  const max = range.v === 4 ? 32 : 128;
  const mask = range.prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(range.prefix)) - BigInt(1)) << BigInt(max - range.prefix);
  return (ip.big & mask) === range.base;
}

/** Loopback addresses are the same machine whichever family the socket used. */
function aliases(ip: string): string[] {
  const p = parseIp(ip);
  if (!p) return [ip];
  if ((p.v === 4 && p.big === parseV4("127.0.0.1")) || (p.v === 6 && p.big === BigInt(1))) return ["127.0.0.1", "::1"];
  return [ip];
}

export function ipAllowed(ip: string, entries: string[]): boolean {
  const ranges = entries.map(parseCidr).filter((r): r is CidrRange => !!r);
  return aliases(ip).some((candidate) => ranges.some((r) => cidrContains(r, candidate)));
}

/** Throws-free check used by tRPC: null when allowed, else a human message. */
export function ipBlockReason(orgId: string | null | undefined, ip: string): string | null {
  if (!orgId) return null;
  const p = policyFor(orgId).ipAllowlist;
  if (!p.enabled || p.entries.length === 0) return null;
  if (ipAllowed(ip, p.entries.map((e) => e.cidr))) return null;
  return `Access from ${ip === "local" ? "this network" : ip} is blocked by your workspace's IP allow-list. Ask a workspace admin to add it in Settings → Security.`;
}

export function normalizeCidr(raw: string): string | null {
  const r = parseCidr(raw);
  if (!r) return null;
  const s = raw.trim();
  return s.includes("/") ? s : `${s}/${r.v === 4 ? 32 : 128}`;
}

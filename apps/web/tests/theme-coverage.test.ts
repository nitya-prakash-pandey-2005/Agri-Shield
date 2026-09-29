/**
 * Guards the theme remap layer (app/themes.css): every dark-first utility the
 * UI uses (text-white, text-slate-*, bg-[#0…], border-white/…, bg-slate-9xx/…)
 * must have a Daylight / Midnight / High Contrast remap — or be listed below
 * as intentionally theme-neutral. Add a remap to app/themes.css when this fails.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "app/themes.css"), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".next")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const TOKEN = /^((?:[a-z-]+:|data-\[[^\]]+\]:|\[&_\[[a-z-]+\]\]:)*)(!?)(bg|text|border|border-[tblrxy]|divide|ring|ring-offset|from|via|to|fill|placeholder|decoration)-(\[#[0-9a-fA-F]{6}\]|white|black|slate-[0-9]+)(\/(?:\[[0-9.]+\]|[0-9]+))?$/;

/** Theme-neutral on purpose: solid white/black marks, dark ink on bright fills, mid-grey dots, brand hexes. */
const NEUTRAL: RegExp[] = [
  /^(hover:)?bg-white(\/(50|70))?$/,
  /^ring-white$/,
  /^from-white$/,
  /^bg-black$/,
  /^(focus:)?text-slate-(900|950)$/,
  /^bg-slate-(400|500)(\/\d+)?$/,
  /^(bg|text|to)-\[#(075e54|0b141a|202c33|2a3942|2a1d12)\]$/, // phone / messaging mock-ups
  /^bg-\[#([4-9a-f][0-9a-f]{5}|2[0-9a-f]{5}|3[0-9a-f]{5})\]$/, // saturated brand / risk colours
];

const esc = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);

describe("theme remap coverage", () => {
  const tokens = new Set<string>();
  for (const f of [...sourceFiles(path.join(ROOT, "app")), ...sourceFiles(path.join(ROOT, "components"))]) {
    for (const raw of fs.readFileSync(f, "utf8").split(/[\s"'`{}(),]+/)) {
      const t = raw.replace(/[;.]$/, "");
      if (TOKEN.test(t)) tokens.add(t);
    }
  }

  it("finds the dark-first utilities in the codebase", () => {
    expect(tokens.size).toBeGreaterThan(150);
    expect(tokens.has("text-white")).toBe(true);
  });

  it("remaps every dark-first utility (or it is deliberately theme-neutral)", () => {
    const missing = [...tokens].filter((t) => !NEUTRAL.some((re) => re.test(t)) && !CSS.includes("." + esc(t)));
    expect(missing, `Add remaps to app/themes.css for: ${missing.join(" ")}`).toEqual([]);
  });

  it("defines the full token set for every non-default theme and for dark islands", () => {
    const blocks = {
      light: CSS.match(/:root\.light \{([\s\S]*?)\n\}/)?.[1] ?? "",
      midnight: CSS.match(/:root\.midnight \{([\s\S]*?)\n\}/)?.[1] ?? "",
      contrast: CSS.match(/:root\.contrast \{([\s\S]*?)\n\}/)?.[1] ?? "",
      island: CSS.match(/\.theme-island \{([\s\S]*?)\n\}/)?.[1] ?? "",
    };
    const used = new Set([...CSS.matchAll(/var\(--t-([a-z0-9-]+)/g)].map((m) => m[1]!));
    for (const [name, body] of Object.entries(blocks)) {
      const defined = new Set([...body.matchAll(/--t-([a-z0-9-]+):/g)].map((m) => m[1]!));
      const need = name === "island" ? [...used].filter((u) => !u.startsWith("hud-bg") && u !== "selection" && u !== "scrollbar" && u !== "shadow-glow") : [...used];
      const lacking = need.filter((u) => !defined.has(u));
      expect(lacking, `${name} is missing tokens`).toEqual([]);
    }
  });

  it("never restyles Mission Control (all remaps are scoped to the other themes)", () => {
    const scoped = CSS.split("\n").filter((l) => /^[^\s/@*:].*\{$/.test(l) || /^\.[^\s]/.test(l));
    for (const line of scoped) expect(line.startsWith(":root") || line.startsWith(":where(:root"), line).toBe(true);
    expect(CSS).not.toMatch(/(^|\n)\s*\.dark\b/);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "../../../packages/i18n/locales");
const SPEC_LANGS = ["en", "hi", "bn", "vi", "fil", "id", "ta", "si"];

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Tree, key, out);
    else out[key] = String(v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{?\s*([\w.]+)\s*\}?\}/g)].map((m) => m[1]).sort();

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const locales = Object.fromEntries(files.map((f) => [f.replace(/\.json$/, ""), flatten(JSON.parse(readFileSync(join(DIR, f), "utf-8")) as Tree)]));
const en = locales.en!;

describe("i18n completeness (packages/i18n/locales)", () => {
  it("has an English source catalogue with keys", () => {
    expect(en).toBeDefined();
    expect(Object.keys(en).length).toBeGreaterThan(10);
  });

  it("ships every spec language (§9)", () => {
    for (const l of SPEC_LANGS) expect(files, `${l}.json`).toContain(`${l}.json`);
  });

  for (const [lang, dict] of Object.entries(locales)) {
    if (lang === "en") continue;
    describe(lang, () => {
      it("has exactly en.json's key set", () => {
        const missing = Object.keys(en).filter((k) => !(k in dict));
        const extra = Object.keys(dict).filter((k) => !(k in en));
        expect(missing, `missing in ${lang}`).toEqual([]);
        expect(extra, `extra in ${lang}`).toEqual([]);
      });
      it("has no empty strings", () => {
        expect(Object.entries(dict).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
      });
      it("keeps interpolation placeholders", () => {
        const broken = Object.keys(en).filter((k) => k in dict && JSON.stringify(placeholders(en[k]!)) !== JSON.stringify(placeholders(dict[k]!)));
        expect(broken, `placeholder mismatch in ${lang}`).toEqual([]);
      });
    });
  }
});

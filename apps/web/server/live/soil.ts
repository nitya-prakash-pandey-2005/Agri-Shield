/**
 * Soil profile from ISRIC SoilGrids 2.0 (250 m global soil maps, CC BY 4.0).
 * Topsoil (0-30 cm) depth-weighted means of clay/sand/silt, pH, organic carbon
 * and CEC, plus a USDA texture class and plain-language agronomic notes.
 * The service is occasionally slow/unavailable → long disk cache + negative cache.
 */
import { fetchJson } from "./http";
import { persisted } from "./disk-cache";

const SOILGRIDS = "https://rest.isric.org/soilgrids/v2.0/properties/query";
const DEPTHS = [
  { label: "0-5cm", w: 5 },
  { label: "5-15cm", w: 10 },
  { label: "15-30cm", w: 15 },
];
const PROPS = ["clay", "sand", "silt", "phh2o", "soc", "cec"] as const;
type Prop = (typeof PROPS)[number];

export interface SoilProfile {
  source: string;
  depth: string;
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
  ph: number | null;
  socGkg: number | null;
  cecCmolKg: number | null;
  texture: string | null;
  drainage: "poor" | "moderate" | "good" | null;
  notes: string[];
}

interface SoilGridsResponse {
  properties: {
    layers: {
      name: string;
      unit_measure: { d_factor: number; target_units: string };
      depths: { label: string; values: { mean: number | null } }[];
    }[];
  };
}

/** USDA soil texture triangle (percentages summing to ~100). */
export function usdaTexture(sand: number, silt: number, clay: number): string {
  if (silt + 1.5 * clay < 15) return "Sand";
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return "Loamy sand";
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) || (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return "Sandy loam";
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return "Loam";
  if ((silt >= 50 && clay >= 12 && clay < 27) || (silt >= 50 && silt < 80 && clay < 12)) return "Silt loam";
  if (silt >= 80 && clay < 12) return "Silt";
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return "Sandy clay loam";
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return "Clay loam";
  if (clay >= 27 && clay < 40 && sand <= 20) return "Silty clay loam";
  if (clay >= 35 && sand > 45) return "Sandy clay";
  if (clay >= 40 && silt >= 40) return "Silty clay";
  if (clay >= 40 && sand <= 45 && silt < 40) return "Clay";
  return "Loam";
}

export function soilNotes(p: Pick<SoilProfile, "clayPct" | "sandPct" | "ph" | "socGkg">): { drainage: SoilProfile["drainage"]; notes: string[] } {
  const notes: string[] = [];
  let drainage: SoilProfile["drainage"] = null;
  if (p.clayPct != null && p.sandPct != null) {
    drainage = p.clayPct >= 35 ? "poor" : p.sandPct >= 60 ? "good" : "moderate";
    if (drainage === "poor") notes.push("Heavy clay drains slowly — standing water after heavy rain lasts longer, raising flood-damage duration; good for paddy rice.");
    if (drainage === "good") notes.push("Sandy soil drains fast and holds little water — crops feel dry spells sooner; irrigate little and often.");
    if (drainage === "moderate") notes.push("Medium texture with balanced drainage and water holding — suits most field crops.");
  }
  if (p.ph != null) {
    if (p.ph < 5.5) notes.push(`Acidic (pH ${p.ph}) — lime may be needed; phosphorus availability is reduced.`);
    else if (p.ph > 8) notes.push(`Alkaline (pH ${p.ph}) — watch for sodicity and zinc/iron deficiency; often linked to salt-affected land.`);
    else notes.push(`pH ${p.ph} is within the comfortable range for most crops.`);
  }
  if (p.socGkg != null) {
    if (p.socGkg < 10) notes.push("Low organic carbon — soil holds less water and nutrients; residues/manure improve resilience to drought.");
    else if (p.socGkg > 25) notes.push("High organic carbon — good structure and water-holding capacity.");
  }
  return { drainage, notes };
}

export function getSoilProfile(lat: number, lon: number): Promise<SoilProfile> {
  const key = `soil:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return persisted(key, 180 * 86_400_000, async () => {
    const q = PROPS.map((p) => `property=${p}`).join("&") + "&" + DEPTHS.map((d) => `depth=${d.label}`).join("&");
    const r = await fetchJson<SoilGridsResponse>(`${SOILGRIDS}?lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}&${q}&value=mean`, 20000);
    const val = (name: Prop): number | null => {
      const layer = r.properties.layers.find((l) => l.name === name);
      if (!layer) return null;
      let s = 0;
      let w = 0;
      for (const d of DEPTHS) {
        const v = layer.depths.find((x) => x.label === d.label)?.values.mean;
        if (v != null) {
          s += (v / (layer.unit_measure.d_factor || 1)) * d.w;
          w += d.w;
        }
      }
      return w ? Math.round((s / w) * 10) / 10 : null;
    };
    // mapped units ÷ d_factor = conventional units (clay/sand/silt %, pH, SOC g/kg, CEC cmol(c)/kg)
    const clayPct = val("clay");
    const sandPct = val("sand");
    const siltPct = val("silt");
    const ph = val("phh2o");
    const socGkg = val("soc");
    const cecCmolKg = val("cec");
    if (clayPct == null && ph == null) throw new Error("SoilGrids has no data here (water, urban or ice)");
    const texture = clayPct != null && sandPct != null && siltPct != null ? usdaTexture(sandPct, siltPct, clayPct) : null;
    const n = soilNotes({ clayPct, sandPct, ph, socGkg });
    return { source: "ISRIC SoilGrids 2.0 (250 m)", depth: "0–30 cm (depth-weighted)", clayPct, sandPct, siltPct, ph, socGkg, cecCmolKg, texture, drainage: n.drainage, notes: n.notes };
  }, { negativeTtlMs: 10 * 60_000 });
}

/**
 * Crop water footprint and irrigation withdrawals, and the water saved by
 * Alternate Wetting and Drying (AWD) in irrigated rice.
 *
 *  Consumptive use (Hoekstra water-footprint convention, ET only):
 *    blue ET  = ETa × irrigation / (irrigation + effective rain)     (share of ET met by irrigation)
 *    green ET = ETa − blue ET
 *    WF (m³/t) = (green + blue) mm × 10 / yield t/ha
 *  Withdrawals (what the farmer pumps / the canal delivers) = irrigation mm × 10 × ha — for
 *  paddy this includes percolation and seepage, which AWD reduces.
 *  AWD saving = withdrawals × 25-30 % (Carrijo et al. 2017 meta-analysis: −25.7 %;
 *  Lampayan et al. 2015: 15-30 %), no yield penalty for safe AWD (≥ −20 kPa / 15 cm).
 *
 * Author: Nitya Prakash Pandey.
 */
import ipccJson from "../data/real/ipcc-rice.json";

const IPCC = ipccJson as unknown as { awd: { waterSavingPct: { central: number; low: number; high: number } }; sources: Record<string, string> };

export interface SeasonWater {
  etaMm: number;
  rainMm: number;
  irrigationMm: number;
  percolationMm: number;
}

export interface WaterFootprint {
  greenMm: number;
  blueMm: number;
  withdrawalM3: number;
  greenM3: number;
  blueM3: number;
  wfM3PerT: number | null;
  wfGreenM3PerT: number | null;
  wfBlueM3PerT: number | null;
}

/** Split season ETa into green and blue, scale to the plot and to the harvested tonne. */
export function waterFootprint(w: SeasonWater, areaHa: number, yieldTHa: number): WaterFootprint {
  const eta = Math.max(0, w.etaMm);
  const irr = Math.max(0, w.irrigationMm);
  // effective rain = the part of the water input that was not irrigation and did not run off: ETa + percolation − irrigation
  const effRain = Math.max(0, eta + Math.max(0, w.percolationMm) - irr);
  const blueShare = irr + effRain > 0 ? irr / (irr + effRain) : 0;
  const blue = eta * blueShare;
  const green = eta - blue;
  const prod = yieldTHa * areaHa;
  return {
    greenMm: Math.round(green),
    blueMm: Math.round(blue),
    withdrawalM3: Math.round(irr * 10 * areaHa),
    greenM3: Math.round(green * 10 * areaHa),
    blueM3: Math.round(blue * 10 * areaHa),
    wfM3PerT: prod > 0 ? Math.round(((green + blue) * 10) / yieldTHa) : null,
    wfGreenM3PerT: prod > 0 ? Math.round((green * 10) / yieldTHa) : null,
    wfBlueM3PerT: prod > 0 ? Math.round((blue * 10) / yieldTHa) : null,
  };
}

/** Irrigation withdrawal saved by AWD (m³) — central, low and high estimates. */
export function awdWaterSaving(withdrawalM3: number, pct = IPCC.awd.waterSavingPct.central) {
  const r = IPCC.awd.waterSavingPct;
  return { m3: Math.round(withdrawalM3 * (pct / 100)), lowM3: Math.round(withdrawalM3 * (r.low / 100)), highM3: Math.round(withdrawalM3 * (r.high / 100)), pct };
}

export const WATER_REFERENCE = {
  awdSaving: IPCC.awd.waterSavingPct,
  source: IPCC.sources.awd_water,
  benchmark: IPCC.sources.water_benchmark,
  riceGlobalWfM3PerT: { total: 1673, green: 1146, blue: 341, grey: 187 },
};

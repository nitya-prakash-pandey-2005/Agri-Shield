/**
 * Plain-language interpretation of a location report: "What this means for
 * you" + recommended actions tailored to the asset type and crop.
 * Pure (no React) — shared by the report panel, shared-report page and PDF.
 */
import { CROP_EC_THRESHOLDS, type AssetType, type CropType } from "@agri-shield/types";
import { assetGroup, cropLabel, type ReportBundle } from "./types";

export type Urgency = "now" | "this week" | "this season" | "long term";
export interface Action {
  urgency: Urgency;
  hazard: "flood" | "salinity" | "drought" | "heat" | "climate" | "general";
  title: string;
  detail: string;
}
export interface Insight {
  headline: string;
  meaning: string[];
  actions: Action[];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const mm = (v: number) => `${Math.round(v)} mm`;

export function buildInsights(b: Pick<ReportBundle, "report" | "climate" | "outlook">, assetType: AssetType, crop: CropType): Insight {
  const r = b.report;
  const x = r.extras ?? {};
  const g = assetGroup(assetType);
  const place = r.location.name ?? "this location";
  const cropName = cropLabel(crop).toLowerCase();
  const hz = r.hazards;
  const meaning: string[] = [];
  const actions: Action[] = [];
  const rain72 = r.forecast.hourly.reduce((s, h) => s + h.precipMm, 0);
  const history = b.climate?.history ?? x.climate ?? null;
  const drought = b.climate?.drought ?? x.drought ?? null;
  const seasonal = b.outlook?.seasonal ?? x.seasonal ?? null;
  const projection = b.outlook?.projection ?? x.projection ?? null;
  const rarity = x.forecastRarity ?? null;

  // ── Flood ──
  const p72 = hz.flood.p72;
  if (p72 >= 0.35 || rain72 >= 60) {
    const rare = rarity && Math.max(rarity.dailyReturnPeriodYears ?? 0, rarity.threeDayReturnPeriodYears ?? 0);
    meaning.push(
      `There is a ${pct(p72)} chance of flooding in the next 72 hours with ${mm(rain72)} of rain expected${rare && rare >= 2 ? ` — rain this heavy happens here only about once every ${Math.round(rare)} years` : ""}.`
    );
    const now: Record<typeof g, [string, string]> = {
      crop: [`Protect the ${cropName} crop and inputs`, "Harvest anything mature, move seed, fertiliser and livestock to high ground, and clear field drainage outlets before the rain."],
      facility: ["Flood-proof the site", "Raise stock at least 1 m off the floor, sandbag doors and low vents, move vehicles and test sump pumps and back-up power."],
      people: ["Activate early warning", "Send the alert to community focal points, pre-position boats, drinking water and ORS, and confirm shelter capacity."],
      finance: ["Flag exposure before the event", "Pre-notify the claims / collections team, consider a short payment moratorium and ask borrowers to document assets before the flood."],
    };
    actions.push({ urgency: p72 >= 0.6 ? "now" : "this week", hazard: "flood", title: now[g][0], detail: now[g][1] });
  } else if (p72 >= 0.15) {
    meaning.push(`Flood chance is low-to-moderate (${pct(p72)} within 72 h); no heavy rain signal yet.`);
  } else {
    meaning.push(`No flood signal in the next 72 hours (${pct(p72)} probability, ${mm(rain72)} rain forecast).`);
  }
  const river = x.riverHistory;
  if (river?.significantRiver && river.current && river.current.percentileSeason >= 90) {
    meaning.push(`The nearby river is running higher than on ${river.current.percentileSeason}% of days at this time of year since ${river.period[0]}.`);
  }

  // ── Salinity ──
  if (hz.salinity.applicable) {
    const t = CROP_EC_THRESHOLDS[crop] ?? CROP_EC_THRESHOLDS.rice;
    const ec = hz.salinity.ec30d;
    if (ec >= t.sensitive) {
      meaning.push(`Salinity is expected to reach ${ec.toFixed(1)} dS/m within 30 days — above the ${t.sensitive} dS/m where ${cropName} starts losing yield (${pct(hz.salinity.cropDamageProb)} chance of damage).`);
      const act: Record<typeof g, [string, string]> = {
        crop: ["Irrigate only with fresh water", `Check canal/river EC before pumping (keep below ${t.sensitive} dS/m for ${cropName}); store fresh water now and consider salt-tolerant varieties for the next season.`],
        facility: ["Check process water quality", "Test the EC of intake water daily; saline water corrodes equipment and can breach food-safety specs."],
        people: ["Secure drinking water", "Distribute water-storage containers and check tube-well salinity; saline drinking water raises blood-pressure risk."],
        finance: ["Review salinity-exposed loans", "Borrowers growing sensitive crops may see yield losses; offer crop-switch advisory or restructure repayment dates."],
      };
      actions.push({ urgency: ec >= t.moderate ? "now" : "this week", hazard: "salinity", title: act[g][0], detail: act[g][1] });
    } else {
      meaning.push(`Salinity stays below the ${cropName} damage threshold (${ec.toFixed(1)} vs ${t.sensitive} dS/m).`);
    }
  }

  // ── Drought ──
  const spi90 = drought?.spi90 ?? hz.drought.spi90 ?? null;
  if ((spi90 != null && spi90 <= -1) || hz.drought.score >= 35) {
    meaning.push(
      spi90 != null && spi90 <= -1
        ? `The last 90 days were ${drought?.category90?.toLowerCase() ?? "dry"} — only ${drought?.pctOfNormal90 ?? "–"}% of normal rain (SPI ${spi90.toFixed(1)}).`
        : `Evaporation will exceed rainfall by ${Math.abs(Math.round(hz.drought.waterBalance7dMm))} mm over the next week.`
    );
    const act: Record<typeof g, [string, string]> = {
      crop: ["Stretch available water", `Prioritise irrigation at ${cropName} flowering, mulch to cut evaporation, and delay new sowing until soil moisture recovers.`],
      facility: ["Plan for supply shortfall", "Expect lower local harvests and higher raw-material prices; secure alternative suppliers and water for operations."],
      people: ["Prepare water & food support", "Map water points, plan water trucking and cash transfers before the lean season."],
      finance: ["Watch repayment stress", "Dry-spell yields may fall; consider rescheduling instalments tied to harvest dates."],
    };
    actions.push({ urgency: "this week", hazard: "drought", title: act[g][0], detail: act[g][1] });
  }

  // ── Heat ──
  const hi = x.heatStress?.heatIndexMaxC ?? hz.heat.heatIndexMaxC ?? null;
  const wb = x.heatStress?.wetBulbMaxC ?? hz.heat.wetBulbMaxC ?? null;
  if ((hi != null && hi >= 41) || (wb != null && wb >= 28) || (hz.heat.maxTempC ?? 0) >= 35) {
    meaning.push(`Dangerous heat this week: it will feel like ${hi != null ? Math.round(hi) : "–"} °C (wet-bulb ${wb != null ? wb.toFixed(1) : "–"} °C).`);
    actions.push({
      urgency: "this week",
      hazard: "heat",
      title: g === "crop" ? "Protect workers and the crop from heat" : "Protect workers from heat",
      detail: `${x.heatStress?.labourAdvice ?? "Shift heavy work to early morning."}${g === "crop" && (hz.heat.maxTempC ?? 0) >= 35 ? ` Irrigate in the evening; temperatures above 35 °C at flowering sterilise ${cropName} pollen.` : ""}`,
    });
  }

  // ── Season ahead ──
  if (seasonal) {
    const next = seasonal.months.slice(0, 3);
    const drier = next.filter((m) => m.signal === "drier").length;
    const wetter = next.filter((m) => m.signal === "wetter").length;
    meaning.push(seasonal.summary);
    if (drier >= 2)
      actions.push({ urgency: "this season", hazard: "drought", title: "Plan for a drier season", detail: g === "crop" ? "Choose shorter-duration or drought-tolerant varieties, secure irrigation water and budget for supplemental watering." : "Expect tighter water supply and weaker harvests over the next 3 months; adjust sourcing and liquidity plans." });
    else if (wetter >= 2)
      actions.push({ urgency: "this season", hazard: "flood", title: "Plan for a wetter season", detail: g === "crop" ? "Clean drainage, raise seedbeds, stagger planting and keep flood-tolerant seed in stock." : "Check drainage and insurance cover before the wetter months; review flood-exposed inventory." });
  }

  // ── Long term ──
  if (history) {
    const rp25 = history.returnPeriods.find((q) => q.years === 25);
    if (rp25 && (g === "facility" || g === "people"))
      actions.push({ urgency: "long term", hazard: "flood", title: "Design drainage for the 1-in-25-year storm", detail: `Size drains, culverts and plinth heights for about ${rp25.dailyRainMm} mm in one day / ${rp25.threeDayRainMm} mm over three days (site's own 40-year record).` });
    if (history.trends.hottestDay.significant && history.trends.hottestDay.slopePerDecade > 0.2)
      meaning.push(`The hottest day of the year has warmed by ${history.trends.hottestDay.slopePerDecade.toFixed(1)} °C per decade since ${history.period[0]}.`);
  }
  if (projection) {
    const e = projection.ensemble;
    meaning.push(`By 2050 under a high-emissions scenario, models project ${e.annualRainPct.mean >= 0 ? "+" : ""}${e.annualRainPct.mean}% annual rain, ${e.hotDays.mean >= 0 ? "+" : ""}${Math.round(e.hotDays.mean)} days above 35 °C and ${e.rx1dayPct.mean >= 0 ? "+" : ""}${e.rx1dayPct.mean}% on the wettest day of the year.`);
    if (e.hotDays.mean >= 10 || e.tmaxC.mean >= 1.5)
      actions.push({ urgency: "long term", hazard: "climate", title: "Build heat resilience", detail: g === "crop" ? "Trial heat-tolerant varieties and shift sowing windows; price heat-stress into insurance and lending terms." : "Plan cooling, shaded work areas and cold-chain capacity for a hotter climate." });
    if (e.rx1dayPct.mean >= 8)
      actions.push({ urgency: "long term", hazard: "climate", title: "Expect heavier downpours", detail: "Extreme daily rain is projected to intensify — upgrade drainage and reassess flood cover/collateral values over the asset's lifetime." });
  }
  if (!actions.length) actions.push({ urgency: "this week", hazard: "general", title: "No action needed right now", detail: `No hazard crosses an action threshold at ${place} this week. Add it to your portfolio to be alerted automatically if that changes.` });

  const order: Urgency[] = ["now", "this week", "this season", "long term"];
  actions.sort((a, b) => order.indexOf(a.urgency) - order.indexOf(b.urgency));
  const lvl = r.composite.level;
  const headline =
    lvl === "critical" || lvl === "high"
      ? `Act now: ${place} faces ${lvl} climate risk — ${r.composite.drivers[0]?.toLowerCase() ?? "multiple hazards"}.`
      : lvl === "medium"
        ? `Watch closely: moderate risk at ${place} — ${r.composite.drivers[0]?.toLowerCase() ?? "one hazard is elevated"}.`
        : `Low risk at ${place} this week — keep monitoring.`;
  return { headline, meaning, actions };
}

/**
 * Plain-language glossary used by the Copilot `explain_metric` tool.
 * Definitions describe how Agri-SHIELD computes each number, so answers stay
 * faithful to the platform's methodology (see /docs and location-risk.ts).
 */
export interface GlossaryEntry {
  key: string;
  term: string;
  aliases: string[];
  definition: string;
  howWeCompute: string;
  unit?: string;
  goodToKnow?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    key: "composite",
    term: "Composite climate risk score",
    aliases: ["composite", "composite score", "risk score", "climate score", "overall risk", "composite risk"],
    definition: "A single 0–100 number that summarises how exposed a location is to climate hazards over the next few days.",
    howWeCompute: "The dominant hazard sets the score and secondary hazards add a compounding bonus: max(flood, 0.9×salinity, 0.85×drought, 0.7×heat) + 25% of the second-largest + 10% of the third, capped at 100. Bands: 0–34 low, 35–59 medium, 60–79 high, 80–100 critical.",
    unit: "0–100",
    goodToKnow: "Your workspace 'at risk' threshold (Settings) decides when an asset counts as at risk on dashboards.",
  },
  {
    key: "flood",
    term: "Flood probability (24/48/72 h)",
    aliases: ["flood probability", "flood risk", "flood score", "p72", "72h flood", "flood prob"],
    definition: "The chance that the location experiences damaging flooding within the next 24, 48 or 72 hours.",
    howWeCompute: "Combines forecast rainfall (Open-Meteo), soil moisture, river discharge versus its 30-day mean (GloFAS), elevation and the district's historical flood exposure. The flood risk score is the 72-hour probability × 100.",
    unit: "% (0–100)",
  },
  {
    key: "ec",
    term: "EC (electrical conductivity) / salinity",
    aliases: ["ec", "electrical conductivity", "salinity", "ds/m", "dsm", "salt", "saltwater intrusion", "salinity risk"],
    definition: "How salty soil or water is. Higher EC means more salt, which stunts or kills crops.",
    howWeCompute: "Our salinity model forecasts EC now, in 7 days and in 30 days from coastal distance, season, recent rainfall and sea-level/tide signals.",
    unit: "dS/m (deciSiemens per metre)",
    goodToKnow: "Rice starts losing yield above ~3 dS/m and suffers heavy losses above ~6 dS/m.",
  },
  {
    key: "drought",
    term: "Drought risk (7-day water balance)",
    aliases: ["drought", "drought risk", "water balance", "dry spell", "water deficit"],
    definition: "Whether crops will lose more water to evaporation than they receive from rain over the next week.",
    howWeCompute: "FAO-56 reference evapotranspiration (ET₀) minus forecast rainfall over 7 days; a deficit above 10 mm starts to score, reaching 100 at a 45 mm deficit.",
    unit: "0–100",
  },
  {
    key: "heat",
    term: "Heat risk",
    aliases: ["heat", "heat risk", "heat stress", "heatwave", "tmax"],
    definition: "Risk of crop heat stress from high daytime temperatures in the forecast.",
    howWeCompute: "Scores from the week's maximum temperature: 0 at 32 °C rising to 100 at 42 °C; we also count days at or above 35 °C.",
    unit: "0–100",
  },
  {
    key: "discharge",
    term: "River discharge ratio",
    aliases: ["discharge", "discharge ratio", "river discharge", "glofas", "river flow"],
    definition: "How much water the nearest river is forecast to carry compared with its recent normal.",
    howWeCompute: "Peak GloFAS v4 discharge forecast for the next 4 days divided by the mean of the past 30 days. Above 1.4× is flagged as a flood driver.",
    unit: "× 30-day mean",
  },
  {
    key: "et0",
    term: "ET₀ (reference evapotranspiration)",
    aliases: ["et0", "eto", "evapotranspiration", "et₀"],
    definition: "The water a well-watered reference crop would lose to the air through evaporation and transpiration.",
    howWeCompute: "Provided daily by Open-Meteo using the FAO-56 Penman–Monteith equation.",
    unit: "mm/day",
  },
  {
    key: "spi",
    term: "SPI (Standardised Precipitation Index)",
    aliases: ["spi", "standardised precipitation index", "standardized precipitation index"],
    definition: "How unusual recent rainfall is compared with the long-term record, in standard deviations. Negative = drier than normal, positive = wetter.",
    howWeCompute: "Rainfall totals over a window (e.g. 3 months) are fitted to the historical distribution (ERA5) and converted to a z-score. −1 to −1.5 is moderately dry, below −2 is extremely dry.",
    unit: "standard deviations",
  },
  {
    key: "return_period",
    term: "Return period",
    aliases: ["return period", "1-in-100", "1 in 100", "recurrence interval", "100-year flood"],
    definition: "The average time between events of a given size. A '1-in-50-year' flood has a 2% chance of happening in any year.",
    howWeCompute: "Annual exceedance probability = 1 / return period. It does not mean the event happens only once every 50 years.",
    unit: "years",
  },
  {
    key: "basis_risk",
    term: "Basis risk",
    aliases: ["basis risk"],
    definition: "The gap between what a parametric (index) policy pays and the loss the farmer actually suffers.",
    howWeCompute: "Measured by comparing index triggers (e.g. 72 h rain ≥ 150 mm) with field-level loss evidence; lower-resolution indices usually mean more basis risk.",
    goodToKnow: "Agri-SHIELD reduces basis risk by pairing rainfall triggers with field-level flood and satellite signals.",
  },
  {
    key: "parametric",
    term: "Parametric (index) insurance trigger",
    aliases: ["parametric", "trigger", "payout trigger", "index insurance", "weather index"],
    definition: "A policy that pays automatically when a measured index (e.g. rainfall) crosses a pre-agreed threshold, without a loss adjuster visit.",
    howWeCompute: "The demo book uses a 72-hour rainfall trigger of 150 mm; we watch forecast rainfall against that trigger for every parametric plot.",
  },
  {
    key: "auc",
    term: "AUC (area under the ROC curve)",
    aliases: ["auc", "roc", "roc auc", "model accuracy"],
    definition: "How well a model separates events from non-events. 0.5 is a coin flip, 1.0 is perfect.",
    howWeCompute: "Computed on held-out historical flood events for our flood classifier; see Model metrics in the methodology pages.",
  },
  {
    key: "expected_loss",
    term: "Expected loss (EL)",
    aliases: ["expected loss", "el", "value at risk", "exposure at risk"],
    definition: "The average loss you should expect from a hazard, in money.",
    howWeCompute: "Copilot reports 'exposure at risk' = the total value (sum insured, loan outstanding, cash envelope…) of assets whose composite score is high or critical. It is an exposure figure, not a modelled loss.",
    unit: "USD",
  },
  {
    key: "pd",
    term: "PD / LGD (probability of default, loss given default)",
    aliases: ["pd", "lgd", "probability of default", "loss given default", "default risk"],
    definition: "Credit-risk terms: PD is the chance a borrower defaults; LGD is the share of the loan lost if they do.",
    howWeCompute: "The Lending & Finance module adjusts PD for climate stress; Copilot shows the inputs it can see (days past due, internal rating, climate score).",
  },
  {
    key: "ndvi",
    term: "NDVI (vegetation index)",
    aliases: ["ndvi", "vegetation index", "greenness"],
    definition: "A satellite measure of how green and healthy vegetation is, from −1 to 1; healthy crops are usually 0.5–0.9.",
    howWeCompute: "From NASA MODIS (250 m) and HLS Sentinel/Landsat (30 m) imagery.",
  },
  {
    key: "anticipatory",
    term: "Anticipatory action",
    aliases: ["anticipatory action", "anticipatory", "forecast-based financing", "early action"],
    definition: "Releasing pre-agreed cash or supplies before a forecast disaster hits, instead of after.",
    howWeCompute: "Triggers combine forecast probability with community exposure; the demo NGO uses a 72 h flood probability > 50% readiness rule and a pre-agreed cash transfer per household.",
  },
];

export function findTerm(text: string): GlossaryEntry | null {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}₀\-/ ]+/gu, " ")} `;
  let best: { e: GlossaryEntry; len: number } | null = null;
  for (const e of GLOSSARY) {
    for (const a of [e.key.replace("_", " "), ...e.aliases]) {
      if (t.includes(` ${a} `) && (!best || a.length > best.len)) best = { e, len: a.length };
    }
  }
  return best?.e ?? null;
}

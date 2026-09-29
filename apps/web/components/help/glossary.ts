/**
 * Plain-language glossary for every piece of jargon that appears in the
 * product. Pure data (no React) so the server, the /help/glossary page and
 * the <Explain> popovers all share one source of truth.
 *
 * Rule of thumb for entries: `short` must make sense to a non-technical buyer
 * in one sentence; `body` adds how Agri-SHIELD uses it.
 */

export type GlossaryCategory = "climate" | "hydrology" | "soil" | "satellite" | "models" | "insurance" | "finance" | "platform";

export interface GlossaryEntry {
  /** Display name, e.g. "EC (electrical conductivity)" */
  title: string;
  category: GlossaryCategory;
  /** One sentence a non-specialist understands in 10 seconds */
  short: string;
  /** How it is used in Agri-SHIELD / why it matters */
  body: string;
  example?: string;
  unit?: string;
  related?: string[];
  aliases?: string[];
}

export const GLOSSARY_CATEGORIES: Record<GlossaryCategory, string> = {
  climate: "Weather & climate",
  hydrology: "Floods & rivers",
  soil: "Soil & salinity",
  satellite: "Satellite data",
  models: "Models & accuracy",
  insurance: "Insurance",
  finance: "Lending & finance",
  platform: "Using Agri-SHIELD",
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ─── Soil & salinity ────────────────────────────────────────────────
  ec: {
    title: "EC (electrical conductivity)",
    category: "soil",
    short: "How salty soil or water is — salty water conducts electricity better, so a higher EC means more salt.",
    body: "We estimate soil EC from sea-level, river flow, rainfall and past measurements. Each crop has a tolerance: rice starts losing yield above about 3 dS/m.",
    example: "Fresh irrigation water ≈ 0.5 dS/m; sea water ≈ 50 dS/m.",
    unit: "dS/m",
    related: ["ds_m", "salinity", "salt_tolerance"],
    aliases: ["electrical conductivity", "soil ec"],
  },
  ds_m: {
    title: "dS/m (deciSiemens per metre)",
    category: "soil",
    short: "The unit used to measure salinity (EC). Bigger number = saltier.",
    body: "Below 2 dS/m most crops are fine; 2–4 dS/m hurts sensitive crops; above 8 dS/m only very salt-tolerant crops survive.",
    unit: "dS/m",
    related: ["ec", "salinity"],
    aliases: ["ds/m", "dsm"],
  },
  salinity: {
    title: "Salinity intrusion",
    category: "soil",
    short: "Sea water pushing inland through rivers and groundwater, making soil too salty to farm.",
    body: "Driven by high tides, storm surges, low river flow in the dry season and sea-level rise. Agri-SHIELD forecasts it up to 72 hours ahead and 30 days out.",
    related: ["ec", "storm_surge", "sea_level_anomaly"],
    aliases: ["saltwater intrusion", "salt intrusion"],
  },
  salt_tolerance: {
    title: "Crop salt tolerance",
    category: "soil",
    short: "The salinity level a crop can take before its yield starts to fall.",
    body: "We use FAO thresholds: e.g. rice ≈ 3 dS/m, wheat ≈ 6 dS/m, sugarcane ≈ 1.7 dS/m. Above the threshold, yield drops by a fixed % per extra dS/m.",
    related: ["ec"],
  },
  soil_moisture: {
    title: "Soil moisture",
    category: "soil",
    short: "How wet the ground already is. Wet soil can't absorb more rain, so floods happen faster.",
    body: "Taken from the Open-Meteo forecast (top 0–7 cm). Saturated soil raises flood probability for the same rainfall.",
    unit: "m³/m³",
  },

  // ─── Weather & climate ─────────────────────────────────────────────
  spi: {
    title: "SPI (Standardised Precipitation Index)",
    category: "climate",
    short: "How unusual recent rainfall is compared with normal for that place — negative means drier than usual.",
    body: "SPI below −1 is moderate drought, below −1.5 severe, below −2 extreme. We compute it from ERA5 rainfall history for any coordinate.",
    example: "SPI −1.8 over 3 months ≈ a dry spell you'd expect about once every 15 years.",
    related: ["era5", "drought"],
    aliases: ["standardised precipitation index", "standardized precipitation index"],
  },
  drought: {
    title: "Drought risk",
    category: "climate",
    short: "The chance that too little rain (and too much heat) will stress crops.",
    body: "Combines recent rainfall deficit (SPI), forecast rain, temperature and soil moisture into a 0–100 score.",
    related: ["spi", "composite_score"],
  },
  heat_stress: {
    title: "Heat stress",
    category: "climate",
    short: "Days hot enough to damage crops or livestock — for rice, above about 35 °C at flowering.",
    body: "Counted from the 16-day forecast maximum temperatures and scored 0–100 in the heat component of the composite score.",
    related: ["composite_score"],
    aliases: ["heat risk"],
  },
  era5: {
    title: "ERA5",
    category: "climate",
    short: "A global record of past weather, every hour since 1940, produced by the European weather centre (ECMWF).",
    body: "We use ERA5 (via Open-Meteo Archive) for rainfall history, drought indices and return periods at any location on Earth.",
    related: ["spi", "return_period"],
    aliases: ["reanalysis"],
  },
  ensemble: {
    title: "Ensemble forecast",
    category: "climate",
    short: "Running the weather model many times with slightly different starting points to see the range of possible outcomes.",
    body: "If most of the 30–50 runs agree, confidence is high. We show the spread (e.g. 10th–90th percentile) instead of a single number.",
    related: ["lead_time", "p90"],
    aliases: ["ensemble members"],
  },
  lead_time: {
    title: "Lead time",
    category: "climate",
    short: "How far ahead of an event a warning is issued.",
    body: "Our flood alerts target 72 hours of lead time — enough to harvest early, move livestock or pre-position cash. Accuracy falls as lead time grows.",
    example: "A 72 h lead time means a Monday warning for a Thursday flood.",
  },
  seasonal_forecast: {
    title: "Seasonal forecast",
    category: "climate",
    short: "An outlook for the next 1–6 months saying whether it will likely be wetter, drier, hotter or cooler than normal.",
    body: "From the ECMWF SEAS5 system via Open-Meteo. It gives tendencies, not daily weather — useful for planting and portfolio planning.",
  },
  cmip6: {
    title: "CMIP6",
    category: "climate",
    short: "The set of global climate models used by the IPCC to project the climate out to 2100.",
    body: "We use downscaled CMIP6 models to show how rainfall and heat at a location could change by 2030/2050 under different emissions paths.",
    related: ["ssp", "climate_projection"],
  },
  ssp: {
    title: "SSP (Shared Socioeconomic Pathway)",
    category: "climate",
    short: "A future scenario for emissions: SSP1-2.6 is low emissions, SSP2-4.5 middle-of-the-road, SSP5-8.5 very high.",
    body: "Climate disclosures (TCFD/ISSB) ask for results under at least two SSPs. Our projections and disclosure reports label which one is used.",
    related: ["cmip6", "physical_risk"],
    aliases: ["ssp2-4.5", "ssp5-8.5", "rcp"],
  },
  climate_projection: {
    title: "Climate projection",
    category: "climate",
    short: "What the climate could look like decades from now under a given emissions scenario — not a weather forecast.",
    body: "Projections describe averages and extremes over 20–30 year windows, so we always compare to a historical baseline.",
    related: ["cmip6", "ssp"],
  },
  sea_level_anomaly: {
    title: "Sea-level anomaly",
    category: "hydrology",
    short: "How much higher or lower the sea is than normal right now (tides, wind, storms).",
    body: "From the Open-Meteo marine model. High anomalies push salt water further up delta rivers.",
    unit: "m",
    related: ["salinity", "storm_surge"],
  },
  storm_surge: {
    title: "Storm surge",
    category: "hydrology",
    short: "A temporary rise of the sea pushed onshore by a cyclone's winds and low pressure.",
    body: "The main cause of cyclone deaths in the Bay of Bengal, and a sudden driver of salinity on coastal farms.",
    related: ["sea_level_anomaly", "gdacs"],
  },

  // ─── Floods & rivers ───────────────────────────────────────────────
  glofas: {
    title: "GloFAS",
    category: "hydrology",
    short: "The Global Flood Awareness System — a Copernicus/EU model that forecasts river flow worldwide, 30 days ahead.",
    body: "We compare today's forecast river discharge with the 30-day average; a ratio above ~1.5 is an early sign of river flooding.",
    related: ["river_discharge", "discharge_ratio"],
    aliases: ["global flood awareness system"],
  },
  river_discharge: {
    title: "River discharge",
    category: "hydrology",
    short: "How much water is flowing down a river each second.",
    body: "Measured in cubic metres per second. Sudden rises upstream arrive downstream hours to days later — that is our lead time.",
    unit: "m³/s",
    related: ["glofas", "discharge_ratio"],
  },
  discharge_ratio: {
    title: "Discharge ratio",
    category: "hydrology",
    short: "Today's forecast river flow divided by its recent average — 2.0 means twice the usual flow.",
    body: "Used as an alert-rule metric (river_discharge_ratio). Above 1.5 we raise flood risk for assets near the river.",
    related: ["river_discharge", "glofas"],
  },
  flood_probability: {
    title: "Flood probability (24/72 h)",
    category: "hydrology",
    short: "The chance, from 0 to 100%, that a location floods in the next 24 or 72 hours.",
    body: "Produced by our flood model from forecast rain, soil moisture, river discharge, elevation and past floods. 60%+ triggers warnings by default.",
    related: ["lead_time", "auc", "brier_score"],
    aliases: ["p72", "flood risk", "72h flood probability"],
  },
  return_period: {
    title: "Return period",
    category: "hydrology",
    short: "How rare an event is: a '1-in-100-year flood' has a 1% chance of happening in any given year.",
    body: "It does not mean it happens once a century — two can happen in consecutive years. We estimate return periods from ERA5 rainfall and GloFAS flow history.",
    example: "1-in-10-year = 10% chance each year; 1-in-50 = 2%.",
    related: ["pml", "exceedance_probability"],
    aliases: ["recurrence interval", "1-in-100"],
  },
  exceedance_probability: {
    title: "Exceedance probability",
    category: "insurance",
    short: "The chance that a loss or hazard will be bigger than a given amount in a year.",
    body: "Plotted as an EP curve. Reading it at 1% gives the 1-in-100-year loss (the PML).",
    related: ["return_period", "pml"],
    aliases: ["ep curve", "aep", "oep"],
  },
  elevation: {
    title: "Elevation (DEM)",
    category: "hydrology",
    short: "Height of the land above sea level. Low-lying land floods and salinises more easily.",
    body: "From the Copernicus 90 m digital elevation model via Open-Meteo.",
    unit: "m",
  },

  // ─── Satellite ─────────────────────────────────────────────────────
  ndvi: {
    title: "NDVI (vegetation index)",
    category: "satellite",
    short: "A satellite measure of how green and healthy plants are, from −1 to 1; healthy crops are usually 0.5–0.9.",
    body: "We read NASA MODIS 250 m NDVI every 16 days. A drop of 20% or more versus the previous reading flags crop stress.",
    related: ["modis", "sentinel"],
    aliases: ["normalized difference vegetation index", "normalised difference vegetation index"],
  },
  modis: {
    title: "MODIS",
    category: "satellite",
    short: "NASA satellite sensors that photograph the whole Earth every day at 250 m–1 km detail.",
    body: "Used for NDVI crop health and the 2-day observed-flood layer on our maps.",
    related: ["ndvi", "gibs"],
  },
  sentinel: {
    title: "Sentinel-2 / Landsat (HLS)",
    category: "satellite",
    short: "European and US satellites with 30 m detail — sharp enough to see individual fields.",
    body: "Shown via NASA's Harmonized Landsat-Sentinel (HLS) layer. Clouds can hide the ground during the monsoon.",
    related: ["ndvi"],
    aliases: ["hls", "landsat", "sentinel-2"],
  },
  gibs: {
    title: "NASA GIBS",
    category: "satellite",
    short: "NASA's free service that serves satellite imagery as map tiles.",
    body: "Our satellite, observed-flood and NDVI basemaps all come from GIBS.",
    related: ["modis"],
  },
  jrc_surface_water: {
    title: "JRC Global Surface Water",
    category: "satellite",
    short: "A 38-year satellite record of where water has appeared on Earth — shows land that floods often.",
    body: "The 'water occurrence' layer shows the % of time each 30 m pixel was water between 1984 and 2021.",
    aliases: ["surface water occurrence", "jrc"],
  },

  // ─── Hazard feeds ──────────────────────────────────────────────────
  gdacs: {
    title: "GDACS",
    category: "hydrology",
    short: "The UN/EU Global Disaster Alert and Coordination System — official alerts for floods, cyclones, droughts and earthquakes.",
    body: "We pull orange and red GDACS alerts in near real time and show those near your assets on the Home screen.",
    related: ["eonet"],
  },
  eonet: {
    title: "NASA EONET",
    category: "hydrology",
    short: "NASA's feed of natural events (storms, floods, wildfires) spotted by satellites.",
    body: "Complements GDACS in the live hazards list.",
    related: ["gdacs"],
  },

  // ─── Models & accuracy ─────────────────────────────────────────────
  composite_score: {
    title: "Composite risk score",
    category: "models",
    short: "One 0–100 number combining flood, salinity, drought and heat risk — higher means more danger.",
    body: "The biggest hazard dominates, and others add on top. 0–34 low, 35–59 medium, 60–79 high, 80+ critical. Your workspace's 'at risk' threshold is set in Settings.",
    related: ["risk_threshold", "flood_probability", "drought"],
    aliases: ["composite", "risk score"],
  },
  risk_threshold: {
    title: "At-risk threshold",
    category: "platform",
    short: "The composite score above which an asset counts as 'at risk' on your dashboards (default 60).",
    body: "Change it in Settings → General. Lower it to be more cautious; raise it to see only the worst cases.",
    related: ["composite_score"],
  },
  auc: {
    title: "AUC (area under the ROC curve)",
    category: "models",
    short: "How well a model separates events from non-events: 0.5 is a coin flip, 1.0 is perfect.",
    body: "Our flood model is validated on held-out historical floods; above 0.8 is considered good for early warning.",
    related: ["brier_score", "precision_recall"],
    aliases: ["roc auc", "roc"],
  },
  brier_score: {
    title: "Brier score",
    category: "models",
    short: "How close probability forecasts were to what actually happened: 0 is perfect, lower is better.",
    body: "Unlike AUC it also checks calibration — if we say 70%, it should flood about 70% of the time.",
    related: ["auc", "calibration"],
  },
  calibration: {
    title: "Calibration",
    category: "models",
    short: "Whether predicted probabilities match reality — a well-calibrated 30% happens about 3 times in 10.",
    body: "We show reliability diagrams on the model page so underwriters can trust the numbers as probabilities.",
    related: ["brier_score"],
  },
  precision_recall: {
    title: "Precision & recall",
    category: "models",
    short: "Precision: of the alarms raised, how many were real. Recall: of the real events, how many we caught.",
    body: "Early-warning systems favour high recall (missing a flood is worse than a false alarm), within an acceptable false-alarm rate.",
    related: ["auc", "false_alarm"],
    aliases: ["precision", "recall", "hit rate"],
  },
  false_alarm: {
    title: "False-alarm rate",
    category: "models",
    short: "How often a warning is issued but the event doesn't happen.",
    body: "Too many false alarms and people stop listening. We tune thresholds per workspace to balance this against missed events.",
    related: ["precision_recall"],
  },
  confidence: {
    title: "Confidence",
    category: "models",
    short: "How sure the model is about a number, based on data quality and forecast agreement.",
    body: "Shown as high / medium / low. Low confidence usually means missing data or ensemble members disagreeing.",
    related: ["ensemble"],
  },
  monte_carlo: {
    title: "Monte Carlo simulation",
    category: "models",
    short: "Running thousands of random 'what-if' versions of the future to see the range of possible losses.",
    body: "Used for portfolio loss distributions, supply-chain disruption and parametric payout estimates.",
    related: ["p90", "var"],
  },
  p90: {
    title: "P90 / percentile",
    category: "models",
    short: "A value only exceeded in 10% of simulated outcomes — a 'bad but plausible' case.",
    body: "P50 is the median outcome; P90 and P99 describe the tail used for capital and reserve decisions.",
    related: ["monte_carlo", "var"],
    aliases: ["p50", "p99", "percentile"],
  },
  model_drift: {
    title: "Model drift",
    category: "models",
    short: "When a model's accuracy slowly worsens because the world (or the data) has changed.",
    body: "We monitor live performance and retrain monthly; drift alerts appear on the model status page.",
  },
  rag: {
    title: "RAG (retrieval-augmented generation)",
    category: "models",
    short: "An AI assistant that looks up trusted documents before answering, and cites them.",
    body: "The Copilot answers from your workspace data plus agronomy and disaster-risk references, so answers can be checked.",
    aliases: ["copilot"],
  },

  // ─── Insurance ─────────────────────────────────────────────────────
  parametric: {
    title: "Parametric insurance",
    category: "insurance",
    short: "Insurance that pays automatically when a measured index (e.g. 150 mm of rain in 3 days) crosses a trigger — no loss adjuster needed.",
    body: "Fast and cheap to run, but the payout may not match the farmer's actual loss (basis risk).",
    related: ["trigger", "basis_risk", "index_insurance"],
    aliases: ["parametric cover"],
  },
  index_insurance: {
    title: "Index insurance",
    category: "insurance",
    short: "Cover based on an index such as rainfall or area-average yield rather than each farm's individual loss.",
    body: "Includes weather-index and area-yield-index products — common for smallholders where farm-by-farm claims are too costly.",
    related: ["parametric", "area_yield"],
  },
  area_yield: {
    title: "Area-yield index",
    category: "insurance",
    short: "Pays when the average yield of a whole area (e.g. a district) falls below a guaranteed level.",
    body: "Less basis risk than rainfall triggers for yield losses, but slower because it waits for crop-cutting surveys.",
    related: ["index_insurance"],
  },
  trigger: {
    title: "Trigger / exit (parametric)",
    category: "insurance",
    short: "The index level where a parametric policy starts paying (trigger) and where it pays 100% (exit).",
    body: "Between trigger and exit the payout rises in a straight line. Our simulator shows how many policies would pay today.",
    related: ["parametric", "payout"],
    aliases: ["exit", "strike"],
  },
  payout: {
    title: "Payout",
    category: "insurance",
    short: "The money paid to the policyholder when a claim or trigger is met.",
    body: "For parametric policies we estimate payouts from forecasts before the event, so insurers can reserve cash early.",
  },
  basis_risk: {
    title: "Basis risk",
    category: "insurance",
    short: "The risk that an index policy doesn't pay when the farmer actually lost crops — or pays when they didn't.",
    body: "It happens when the weather station or grid cell doesn't match conditions on the farm. Using finer data and multiple indices reduces it.",
    related: ["parametric", "index_insurance"],
  },
  burning_cost: {
    title: "Burning cost",
    category: "insurance",
    short: "What a policy would have paid out on average in past years — a starting point for the premium.",
    body: "Calculated by replaying the policy's trigger against 20–40 years of ERA5/GloFAS history, as a % of the sum insured.",
    related: ["loss_ratio", "premium_rate"],
  },
  loss_ratio: {
    title: "Loss ratio",
    category: "insurance",
    short: "Claims paid divided by premiums earned. Above 100% the insurer loses money on the book.",
    body: "Agricultural books typically target 60–75% to cover costs and reinsurance.",
    related: ["burning_cost"],
  },
  premium_rate: {
    title: "Premium rate",
    category: "insurance",
    short: "The price of cover as a percentage of the sum insured.",
    body: "Built from burning cost plus loadings for uncertainty, expenses and profit.",
    related: ["burning_cost", "sum_insured"],
  },
  sum_insured: {
    title: "Sum insured",
    category: "insurance",
    short: "The maximum amount a policy will pay.",
    body: "In your portfolio this is the 'value' of an insured plot and counts towards exposure.",
    related: ["exposure"],
  },
  deductible: {
    title: "Deductible",
    category: "insurance",
    short: "The part of a loss the policyholder bears before the insurance pays.",
    body: "Indemnity (MPCI) policies in the demo book carry a 20% deductible.",
  },
  pml: {
    title: "PML (probable maximum loss)",
    category: "insurance",
    short: "The biggest loss you'd reasonably expect from a rare event, e.g. the 1-in-100-year loss.",
    body: "Used to size reinsurance and capital. We estimate it from simulated events across the whole portfolio at once.",
    related: ["return_period", "exceedance_probability", "var"],
    aliases: ["probable maximum loss"],
  },
  aal: {
    title: "AAL (average annual loss)",
    category: "insurance",
    short: "The loss you'd expect per year on average over many years.",
    body: "The 'expected' cost of risk — the core of a technical premium.",
    related: ["pml", "burning_cost"],
    aliases: ["average annual loss", "expected loss"],
  },
  reinsurance: {
    title: "Reinsurance",
    category: "insurance",
    short: "Insurance for insurers — it caps their loss from big events.",
    body: "PML and accumulation reports from Agri-SHIELD support reinsurance renewals.",
  },
  accumulation: {
    title: "Accumulation",
    category: "insurance",
    short: "Too much insured value concentrated in one area that a single flood or cyclone could hit.",
    body: "The portfolio map clusters exposure so you can spot hotspots before they become a correlated loss.",
    related: ["exposure", "pml"],
    aliases: ["concentration risk"],
  },

  // ─── Finance ───────────────────────────────────────────────────────
  exposure: {
    title: "Exposure",
    category: "finance",
    short: "The money at stake: sum insured, loan balance, stock or asset value in the path of a hazard.",
    body: "Your Home screen totals exposure across all active assets; 'at-risk exposure' is the part above your risk threshold.",
    related: ["ead", "sum_insured"],
  },
  pd: {
    title: "PD (probability of default)",
    category: "finance",
    short: "The chance a borrower won't repay within a year.",
    body: "We show how a climate shock (flood, salinity) raises each borrower's PD, e.g. from 2% to 5%, so banks can price and provision.",
    related: ["lgd", "ead", "expected_credit_loss"],
    aliases: ["probability of default"],
  },
  lgd: {
    title: "LGD (loss given default)",
    category: "finance",
    short: "If a borrower defaults, the share of the loan the bank actually loses after recovering collateral.",
    body: "Flooded land or dead orchards lower collateral value, which raises LGD.",
    related: ["pd", "ead"],
    aliases: ["loss given default"],
  },
  ead: {
    title: "EAD (exposure at default)",
    category: "finance",
    short: "How much the borrower owes at the moment they default.",
    body: "For our demo loan book this is the outstanding balance.",
    related: ["pd", "lgd"],
    aliases: ["exposure at default"],
  },
  expected_credit_loss: {
    title: "Expected credit loss (ECL)",
    category: "finance",
    short: "PD × LGD × EAD — the loss a lender should expect and set aside provisions for.",
    body: "IFRS 9 asks banks to include forward-looking information such as climate forecasts in ECL.",
    related: ["pd", "lgd", "ead"],
    aliases: ["ecl", "ifrs 9"],
  },
  var: {
    title: "Value-at-risk (VaR)",
    category: "finance",
    short: "A loss amount you'd only exceed with a small probability, e.g. 95% VaR = the loss beaten only 1 year in 20.",
    body: "Climate VaR applies the idea to weather-driven losses in a portfolio.",
    related: ["pml", "p90", "monte_carlo"],
    aliases: ["value at risk", "climate var", "cvar"],
  },
  stress_test: {
    title: "Stress test",
    category: "finance",
    short: "Checking how a portfolio would cope with a severe but plausible shock — e.g. a 1-in-50-year monsoon.",
    body: "Run scenarios in Portfolio or Finance to see losses, defaults and payouts under each shock.",
    related: ["monte_carlo", "var"],
  },
  physical_risk: {
    title: "Physical climate risk",
    category: "finance",
    short: "Losses caused directly by weather and climate — floods, drought, heat, sea-level rise.",
    body: "Distinct from 'transition risk' (policy and market changes). Disclosures under TCFD/ISSB S2 cover both.",
    related: ["tcfd", "ssp"],
    aliases: ["acute risk", "chronic risk"],
  },
  tcfd: {
    title: "TCFD / ISSB S2",
    category: "finance",
    short: "International standards for how companies must report climate-related risks to investors.",
    body: "Our physical-risk disclosure report follows their structure (governance, strategy, risk management, metrics).",
    related: ["physical_risk"],
    aliases: ["issb", "ifrs s2"],
  },
  dpd: {
    title: "DPD (days past due)",
    category: "finance",
    short: "How many days a loan repayment is late.",
    body: "Banks watch DPD rising after a disaster; our finance module links DPD to recent hazard exposure.",
    aliases: ["days past due"],
  },

  // ─── Anticipatory action & platform ─────────────────────────────────
  anticipatory_action: {
    title: "Anticipatory action",
    category: "platform",
    short: "Acting before a disaster hits — e.g. sending cash to families 3 days before a forecast flood.",
    body: "Pre-agreed triggers and plans let NGOs and governments release funds automatically when a forecast crosses a threshold.",
    related: ["trigger", "lead_time"],
    aliases: ["forecast-based financing", "fbf"],
  },
  alert_rule: {
    title: "Alert rule",
    category: "platform",
    short: "An 'if this, then tell me' instruction — e.g. if flood probability on coastal plots goes above 60%, email the claims team.",
    body: "Create rules in Alerts & Rules. Each rule has conditions, a scope (which assets), channels and a cooldown so you aren't spammed.",
    related: ["cooldown"],
  },
  cooldown: {
    title: "Cooldown",
    category: "platform",
    short: "The minimum wait before the same rule can alert you again.",
    body: "Stops a rule that stays true (e.g. a flood lasting days) from sending a message every hour.",
  },
  webhook: {
    title: "Webhook",
    category: "platform",
    short: "A message our servers send to your system automatically when something happens, so your software can react.",
    body: "Deliveries are signed with a secret (HMAC-SHA256) so you can verify they really came from Agri-SHIELD.",
    related: ["api_key"],
  },
  api_key: {
    title: "API key",
    category: "platform",
    short: "A secret password that lets your own software pull data from Agri-SHIELD.",
    body: "Shown once when created; we only store a one-way hash (SHA-256). Revoke it instantly if it leaks.",
    related: ["webhook"],
    aliases: ["api keys"],
  },
  geocoding: {
    title: "Geocoding",
    category: "platform",
    short: "Turning a place name or address into map coordinates (latitude/longitude).",
    body: "Uses the Open-Meteo and OpenStreetMap Nominatim geocoders.",
  },
  asset: {
    title: "Asset",
    category: "platform",
    short: "Anything you monitor: an insured plot, a loan, a farm, a warehouse or a community.",
    body: "Each asset has a location and a value; we re-score them against the latest data and roll them up into your portfolio.",
    related: ["exposure"],
  },
  provenance: {
    title: "Source tag (provenance)",
    category: "platform",
    short: "The small label next to a number that says where it came from and how fresh it is.",
    body: "Every figure in Agri-SHIELD carries one, so you can audit it or cite it in a report.",
  },
  sla: {
    title: "SLA (service-level agreement)",
    category: "platform",
    short: "A written promise about uptime and support response times.",
    body: "See the Trust page for the targets that apply to each plan.",
  },
};

/** Normalise a term key / alias for lookup: "dS/m" → "ds_m" */
export const normTerm = (t: string) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const ALIAS_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [k, e] of Object.entries(GLOSSARY)) {
    m.set(normTerm(k), k);
    m.set(normTerm(e.title), k);
    for (const a of e.aliases ?? []) m.set(normTerm(a), k);
  }
  return m;
})();

export function lookupTerm(term: string): (GlossaryEntry & { key: string }) | null {
  const key = ALIAS_INDEX.get(normTerm(term));
  return key ? { key, ...GLOSSARY[key]! } : null;
}

/** Case-insensitive search across titles, definitions and aliases. */
export function searchGlossary(q: string): (GlossaryEntry & { key: string })[] {
  const needle = q.trim().toLowerCase();
  const all = Object.entries(GLOSSARY).map(([key, e]) => ({ key, ...e }));
  if (!needle) return all;
  return all
    .map((e) => {
      const hay = [e.title, e.short, e.body, ...(e.aliases ?? [])].join(" ").toLowerCase();
      const score = e.title.toLowerCase().includes(needle) || e.key.includes(needle) ? 2 : hay.includes(needle) ? 1 : 0;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title))
    .map((x) => x.e);
}

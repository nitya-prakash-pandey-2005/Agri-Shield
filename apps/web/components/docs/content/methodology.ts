export const METHODOLOGY_FLOOD = `This page documents how Agri-SHIELD forecasts flood risk, how the model was evaluated, and what it cannot do.

## Two layers

| Layer | Where | Role |
| --- | --- | --- |
| **Trained ensemble** | ML service, \`apps/ml-api/models/flood_predictor.py\` (\`/api/ml/flood-risk\`) | Primary model for point and district predictions |
| **Transparent formula** | Web platform, \`apps/web/server/risk/scoring.ts\` (\`web-formula-v1.2\`) | Live district overlay every 20 minutes, and fallback whenever the ML service is unreachable |

Every response says which one produced it: \`engine\` is \`ml\` or \`formula\`, and \`model_version\` is \`flood-ens-v2.x\` or \`web-formula-v1.2\` / \`formula-v1.2.0\`.

## The ensemble

- **Members**: a temporal multilayer perceptron and histogram gradient-boosted trees, trained per horizon (24, 48, 72 h), several bootstrapped members each, blended by weight.
- **Features**: forecast rain next 24 h and 72 h, rain over the past 7 days, soil moisture, river discharge relative to the site's 95th percentile, elevation, distance to coast, and a static flood-exposure prior per district.
- **Training data**: ERA5 reanalysis and GloFAS v4 discharge for the 22 monitored districts, 2019-2025.
- **Label**: a day is a flood day when GloFAS discharge exceeds the site's 95th percentile, or 3-day rain exceeds its 99th percentile, within the horizon. This is a hydrological proxy, not a record of observed inundation.
- **Split**: by time, not at random. Train 2019-2022, validate 2023, test 2024-2025.
- **Uncertainty**: at inference, 40 Monte Carlo draws perturb forecast rain (log-normal, σ 0.35) and sample ensemble members to give a 90% interval on the 72 h probability.

## Evaluation (held-out 2024-2025)

| Metric | 24 h | 48 h | 72 h |
| --- | --- | --- | --- |
| ROC AUC | 0.980 | 0.972 | 0.968 |
| F1 | | | 0.759 |
| Brier score | | | 0.036 |

For context, a persistence baseline (tomorrow looks like today) reaches AUC 0.80 at 72 h. On **onset** days only (not already flooded), 72 h AUC is 0.93 and F1 0.39: predicting the first day of a flood is much harder than predicting that an ongoing high-water period continues. Live values are served by \`GET /api/ml/metrics\`, together with population-stability drift against live scores once 50 or more are available.

> [!WARNING]
> Scores are evaluated against a discharge/rainfall proxy for 22 district centroids, not against mapped flood footprints. Treat them as well-ranked decision support. They are not calibrated probabilities of your field going under water.

## Formula inputs

| Driver | Source | Notes |
| --- | --- | --- |
| Rainfall next 24/48/72 h | Open-Meteo forecast (hourly \`precipitation\`) | Multi-model blend served by Open-Meteo |
| Soil moisture 0-7 cm | Open-Meteo forecast | Volumetric, m³/m³ |
| River discharge ratio | Copernicus GloFAS via Open-Meteo Flood API | Peak of next 4 days ÷ mean of the previous 30 days |
| Elevation | Open-Meteo Elevation API (Copernicus DEM) | Metres above sea level |
| Static exposure | District definition (\`server/data/geography.ts\`) | 0-1, low-lying floodplain, cyclone track, embankment history |
| Clay fraction, drainage | ISRIC SoilGrids (ML service only) | Top 0-5 cm |

## Formula fallback (web)

Each horizon combines a rainfall term with static and hydrological terms:

\`\`\`text
rainF(mm, pivot) = sigmoid((mm - pivot) / (0.45 × pivot))      pivots: 45 / 70 / 90 mm for 24 / 48 / 72 h
soilF   = clamp((soilMoisture - 0.15) / 0.30)
disF    = clamp((dischargeRatio - 0.8) / 1.2)                    ratio = 1 when GloFAS is unavailable
elevF   = clamp(1 - elevation / 15 m)                            0.5 when unknown
staticF = 0.7 × exposure + 0.3 × elevF

p(h)    = clamp(0.34 × staticF + 0.30 × rainF(h) + 0.14 × soilF + 0.22 × disF)
p48     = max(p24, p48),  p72 = max(p48, p72)                    probabilities never fall with horizon
score   = round(100 × p72)
\`\`\`

Risk levels: **low** < 35 ≤ **medium** < 60 ≤ **high** < 80 ≤ **critical**. A district's overall level uses \`max(flood score, 0.9 × salinity score)\`.

The model also returns the drivers that fired (\`above_avg_rainfall_72h\` when 72 h rain exceeds 80 mm, \`high_soil_saturation\`, \`river_discharge_above_normal\` when the ratio exceeds 1.4, \`low_lying_floodplain\`, \`low_elevation\`), which is what the farmer and government portals show as "why".

## Legacy formula endpoint (ML service)

The older \`/api/v1/flood-risk/predict\` endpoint on the ML service keeps a formula engine with soil data from SoilGrids:

\`\`\`text
rain_factor = max(0, (rain - 0.3 × T) / T)          T = 50/90/130 mm (delta, < 10 m) or 80/140/200 mm (upland)
soil_sat    = soilMoisture² × drainage_factor        drainage from SoilGrids clay %
z = 3.2·rain_factor + 2.1·soil_sat + 1.8·clay + 2.5·river + 1.5·coast + 1.2·elev + 1.0·history + farmer_report − 3.5
p = clip(sigmoid(z), 0.01, 0.99)
risk_score = 25·p24 + 35·p48 + 40·p72
\`\`\`

Distance-to-river, distance-to-coast and elevation factors are stepped lookup tables (for example river < 2 km → 0.90, < 5 km → 0.65). Weather is cached for 30 minutes per location.

## Why 72 hours

Open-Meteo serves forecasts to 16 days, and GloFAS discharge forecasts extend beyond a week. Skill for heavy convective rain drops quickly after three days, so Agri-SHIELD issues decisions at 24, 48 and 72 hours and treats anything longer as outlook only.

## Planned validation

Backtest against mapped flood footprints (Dartmouth Flood Observatory, GDACS, Sentinel-1 flood maps) per district, add reliability curves, and refit per basin as field outcomes logged by farmers accumulate.

## Known limitations

- **Resolution**: one forecast point per district centroid. Flash floods in small catchments can be missed.
- **Embankments and drainage works** are only represented through the static exposure factor.
- **Coastal surge** enters through the salinity model's sea-level term, not the flood score.
- **GloFAS** is designed for large rivers (roughly > 1,000 km² catchments); small rivers show a flat ratio.
- **Scenario mode**: platform administrators can overlay drills (monsoon surge, cyclone landfall, dry-season salinity) on top of live data, or set \`AGRI_SCENARIO\` at boot. Check the admin panel's scenario control before interpreting unusual scores.
`;

export const METHODOLOGY_SALINITY = `Saltwater intrusion is slow-onset: salt moves up tidal rivers in the dry season and into soils through irrigation water. Agri-SHIELD forecasts electrical conductivity (EC, dS/m) and compares it with each crop's tolerance.

## Gradient-boosted EC model (ML service)

\`/api/ml/salinity-risk\` serves \`salinity-hgb-v1.x\`: histogram gradient-boosted regressors that forecast soil EC now and at 7, 30 and 90 days from rainfall deficit, tidal sea level, river discharge, season and coastal exposure.

| Horizon | RMSE (dS/m) | Notes |
| --- | --- | --- |
| Now | 0.65 | |
| 7 days | 0.72 | |
| 30 days | 1.07 | R² 0.86, salinity-class accuracy 0.85 |
| 90 days | 1.40 | |

> [!WARNING]
> The training target is **semi-synthetic**: there is no open, daily soil-EC record for these deltas, so the target combines the physically based curve below with observed drivers. The metrics show the model learns that relationship well; they do not prove field accuracy. Measured EC entered by farmers or officers overrides the model.

## Formula model (web, live districts)

\`\`\`text
season   = monthly intrusion curve [0.75, 0.9, 1.0, 1.0, 0.9, 0.6, 0.45, 0.4, 0.42, 0.5, 0.6, 0.7]  (Jan..Dec, shifted 6 months south of the equator)
dilution = clamp(rain30d / 400 mm)
tide     = clamp((seaLevelAnomaly + 0.5) / 2)        from the Open-Meteo Marine API; 0 when unavailable
EC_now   = 0.4 + exposure × 9 × season × (1 − 0.45 × dilution) × (1 + 0.25 × tide)
EC_30d   = EC_now × (1 + 0.35 × k × exposure)        k = 0.3 in the wet season, 1 otherwise
EC_7d    = EC_now + 0.3 × (EC_30d − EC_now)
score    = round(100 × clamp(EC_30d / 9))
\`\`\`

\`exposure\` encodes distance to the coast and tidal river reach for each district (for example Bến Tre 0.94, Satkhira 0.93, An Giang 0.18).

## Legacy formula (ML service \`/api/v1/salinity/predict\`)

\`\`\`text
base_ec   = 0.5 + clay% / 100 × 2                     SoilGrids clay
coast_amp = 3.5 (< 10 km), 2.0 (< 30 km), 1.2 (< 60 km), 0.8 otherwise
deficit   = 1 + max(0, rainfallDeficit_mm / 200)
oc_buffer = 1 − min(organicCarbon_g/kg / 50, 0.3)
EC_7d = base_ec × coast_amp × deficit × oc_buffer;   EC_30d = 1.15 × EC_7d;   EC_90d = 1.30 × EC_7d   (capped at 15)
\`\`\`

## Salinity classes

| EC (dS/m) | Class | Meaning |
| --- | --- | --- |
| < 2 | Safe | No yield effect for most crops |
| 2-4 | Sensitive | Sensitive crops (vegetables, onion, maize) start losing yield |
| 4-8 | Moderate | Rice and jute yields fall; switch to tolerant varieties |
| ≥ 8 | Severe | Only tolerant crops (barley, some wheat) remain viable |

## Crop tolerance thresholds

Thresholds follow the FAO Irrigation and Drainage Paper 29 (Ayers & Westcot) tables, rounded, as used in \`packages/types\` (\`CROP_EC_THRESHOLDS\`):

| Crop | Yield loss begins | Moderate loss | Severe loss |
| --- | --- | --- | --- |
| Rice | 3.0 | 6.0 | 10.0 |
| Wheat | 6.0 | 9.0 | 13.0 |
| Barley | 8.0 | 12.0 | 18.0 |
| Sorghum | 4.0 | 7.0 | 11.0 |
| Coconut | 5.0 | 8.0 | 12.0 |
| Jute | 2.0 | 4.0 | 8.0 |
| Maize | 1.8 | 3.6 | 5.0 |
| Sugarcane | 1.7 | 3.4 | 7.0 |
| Potato | 1.7 | 3.4 | 5.9 |
| Vegetables | 1.5 | 3.0 | 5.0 |
| Onion | 1.2 | 2.4 | 4.0 |

Crop damage probability rises linearly from 0.15 at the first threshold to 0.97 at the severe threshold.

## Limitations

- EC is **modelled, not measured**: there is no public, real-time soil-salinity network for these deltas. Where farmers or extension officers enter measured EC, it overrides the model.
- The seasonal curve is generic for South and South-East Asian monsoon deltas; upstream dam releases (for example on the Mekong) are not modelled.
- Groundwater salinity and irrigation-water quality are not separated from soil EC.
`;

export const SUPPLY_CHAIN_MODEL = `The supply-chain portal translates district risk into commodity and logistics exposure.

## Node risk

Every supply-chain node (farm cluster, mill, warehouse, port) belongs to a district. Its risk score is

\`\`\`text
nodeRisk = 0.65 × floodRisk + 0.35 × salinityRisk        (ports: flood risk + 4 for coastal surge)
\`\`\`

## Quick commodity score (legacy ML endpoint)

\`\`\`text
climate_risk   = 0.65 × flood_probability + 0.35 × salinity_risk
supply_score   = (1 − climate_risk) × 100
disruption_30d = min(0.95, 1.2 × climate_risk)
volume_at_risk = volume × climate_risk
price_7d (%)   = climate_risk × volatility × 100;   price_30d = 1.3 × price_7d
\`\`\`

Volatility constants per commodity: rice 0.18, wheat 0.12, jute 0.22, sugarcane 0.09, vegetables 0.35 (default 0.15).

## Scenario Monte Carlo

\`POST /api/ml/supply-chain/scenario\` (\`supply-chain-mc-v1.2.0\`, numpy) simulates 100-20,000 futures (default 2,000) for a commodity, a set of regions, an intensity (1-5) and a duration:

- **Flood occurrence** per region is correlated through a Gaussian copula (correlation 0.7 within a country, 0.25 across countries), with hit probability rising with intensity and district exposure.
- **Depth** is log-normal with a common shock; **duration** gamma; **flooded share** of area beta-distributed.
- **Crop damage** follows a depth-duration curve \`Lmax × (1 − e^(−k·dᵅ·tᵝ))\`, calibrated so rice loses about 80% at 0.8 m for 5 days.
- **Logistics**: node outages follow the same copula; trapped stock spoils at a daily rate.
- **Price** impact uses demand elasticity plus volatility noise; **recovery** is duration plus logistics and replanting lag.

Outputs include disruption probability, volume and USD loss with 5-95% intervals, value-at-risk (95%), median price impact and recovery days, a 20-bucket loss histogram and per-region hit probabilities. When the ML service is unavailable, a seeded TypeScript Monte Carlo (\`server/data/sc-montecarlo.ts\`) with similar distributions produces the same fields, so a scenario always returns.

## Limitations

Price impacts are scenario estimates from fixed volatility constants, not market forecasts. They ignore stocks, trade policy and substitution between origins.
`;

export const IMPACT_METHODOLOGY = `How Agri-SHIELD reports impact, and which numbers are live, derived or simulated.

## Categories of numbers

| Label | Meaning | Examples |
| --- | --- | --- |
| **Live** | Read from the platform or an open-data API at request time | Rainfall, discharge, district risk, hazard events, alerts sent |
| **Derived** | Computed from live numbers with a published formula | Farmers protected today, crop value protected (simulated) |
| **Simulated** | From the seeded demo scenario, clearly labelled | Impact stories, pilot figures (15,000+ farmers, 23 agencies, ₹450 Cr) |

## Farmers protected today

In demo mode this counter is \`seeded pilot baseline + 3 × minutes since local midnight\`, a stand-in for alert deliveries that grows through the day. Alerts sent this week and hectares monitored are read directly from the store. With a production database the counter becomes the number of distinct farmers with at least one delivered alert in the last 24 hours.

## Crop value protected (simulated)

Shown on the pitch page:

\`\`\`text
protected USD = hectares monitored
              × share of districts at high or critical risk
              × 1,150 USD/ha   (gross value of a wet-season rice crop: ~4.5 t/ha × ~255 USD/t)
              × 0.30           (damage avoided with early warning, Global Commission on Adaptation 2019)
\`\`\`

This is an order-of-magnitude estimate. It assumes the whole monitored area is under rice and that warnings are acted on as effectively as in the GCA evidence base.

## What we will measure in a real pilot

1. Alert delivery rate and time to delivery by channel.
2. Action rate: share of alerted farmers logging an action within 24 hours.
3. Yield difference between acting and non-acting farms in the same district (difference-in-differences against the previous season).
4. Resource pre-positioning lead time for government partners.
`;

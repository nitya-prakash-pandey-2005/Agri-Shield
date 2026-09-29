# Agri-SHIELD ML API

FastAPI service behind the Agri-SHIELD web app: flood and salinity prediction, a
retrieval-augmented farm advisor, and supply-chain Monte Carlo scenarios.
Author: Nitya Prakash Pandey.

```bash
cd apps/ml-api
python -m pip install -r requirements.txt
python -m uvicorn main:app --port 8000        # docs at http://localhost:8000/docs
python -m pytest -q                           # offline test suite
```

On startup the service loads `model_weights/{flood,salinity}.joblib`. If they are
missing it trains them from the committed datasets in a background thread
(roughly a minute on a laptop) and serves formula-based predictions until the models are ready.
`GET /health` reports `model_status`.

To rebuild the data and weights from scratch:

```bash
python scripts/train-models/build_dataset.py   # pulls open data (about 9k Open-Meteo calls, resumable, cached in data/raw/)
python scripts/train-models/train.py           # trains, evaluates, writes model_weights/ + metrics.json
```

## Endpoints

These endpoints match the contract in `apps/web/server/ml-client.ts`. All fields are snake_case.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ml/flood-risk` | `{lat, lon, forecast_days}` → 24/48/72 h probability, depth, 90 % interval, drivers, 72 hourly points |
| POST | `/api/ml/salinity-risk` | `{lat, lon, crop_type, prediction_horizon_days}` → EC now / +7 d / +30 d (+90 d), class, crop damage, crops, mitigation |
| POST | `/api/ml/advisor` | `{question, farmer_context, language, history}` → markdown answer, action cards, cited sources |
| POST | `/api/ml/supply-chain/scenario` | `{commodity, region_ids, intensity, duration_days, simulations, …}` → Monte Carlo loss distribution |
| GET | `/api/ml/metrics` | held-out metrics of the deployed models |
| POST | `/api/ml/retrain` | champion–challenger retrain (needs `X-API-Key` when `ML_API_KEY` is set) |
| GET | `/health`, `/health/` | `{status, version, models_loaded, uptime_s}` |

Responses may carry extra diagnostic fields such as `features`, `factor_contributions`, `degraded_inputs`, `site`, `ec_predicted_90d` and `regions`. The web contract ignores them.
Validation errors return `422 {"error": "validation_error", "detail": [{field, message, type}]}`.

The older formula endpoints under `/api/v1/*` are unchanged.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Daily rain, soil moisture 0–7 cm, temperature, ET0 (2019–2025) | ERA5 / ERA5-Land reanalysis (Copernicus C3S) via Open-Meteo Historical Weather API | CC BY 4.0 |
| Daily river discharge (2019–2025 reanalysis + live forecast) | Copernicus GloFAS v4 via Open-Meteo Flood API | CC BY 4.0 |
| Sea level (tides + surge) | Open-Meteo Marine API `sea_level_height_msl` | CC BY 4.0 |
| Elevation | Copernicus GLO-90 DEM via Open-Meteo Elevation API | CC BY 4.0 |
| Soil clay 0–5 cm | ISRIC SoilGrids 2.0 | CC BY 4.0 |
| Coastline | Natural Earth 1:10m | Public domain |
| Live forecast | Open-Meteo Forecast API | CC BY 4.0 |

Committed datasets (`data/`):

- `flood_dataset.csv.gz` is a daily panel for the 22 demo districts: rain, soil moisture, temperature, ET0 and discharge.
- `salinity_dataset.csv.gz` holds the daily root-zone ECe target.
- `sites.json` holds per-district static data: elevation, coast distance, the chosen GloFAS river cell, the sea cell with its measured tidal range, and clay content.
- `coastline_asia.npz` holds the coastline vertices.

Raw API responses are cached in `data/raw/`, which is git-ignored.

## Models

### Flood ensemble (`models/flood_predictor.py`)

- **Labels.** Labels are objective and computed per district, using thresholds from the training years only. Day *t* is positive for horizon *k* ∈ {1, 2, 3} if, within *t+1 … t+k*, either:
  - GloFAS discharge at the district's dominant river cell exceeds its 95th percentile (riverine flood), or
  - the 3-day rainfall exceeds its 99th percentile (pluvial waterlogging).
- **temporal-MLP.** A scikit-learn `MLPClassifier` (64-32, multilabel) over the 10-day sequence: 7 past days of rain, soil moisture and log discharge/P95, plus 3 forecast days of rain, plus static features. It is a sequence model by input design, not a recurrent LSTM.
- **HistGradientBoosting.** One classifier per horizon on rolling rain sums, discharge ratios and trend, soil moisture, elevation, coast distance, flood-event history and season.
- **Ensembling.** Both learners are block-bootstrap ensembles over site-months. The blend weight per horizon is tuned on the 2023 validation year by log-loss.
- **Uncertainty.** Monte Carlo sampling over forecast-rain error (log-normal, σ = 0.35) and ensemble members gives the 90 % interval of the 72 h probability.
- **Depth head.** A HistGradientBoosting regressor on a physically derived depth proxy: Manning-type overbank stage plus pluvial ponding.
- **Contributing factors.** Occlusion attribution on the GBM: each feature group is replaced by its climatological median and the probability drop is measured.
- **Forecast-error training.** Training uses observed next-3-day rain as the "forecast" (perfect-prognosis), with the same log-normal error applied so the model learns under forecast noise.

### Salinity (`models/salinity_predictor.py`)

The model is four `HistGradientBoostingRegressor`s on log-EC, for horizons now / +7 / +30 / +90 days. Features are:

- distance to the coast
- elevation
- the district exposure prior
- clay content
- tidal range
- 30- and 90-day rain, ET0 and water deficit
- the GloFAS 30-day discharge ratio and its trend
- the astronomical spring–neap index, now and in 7 days
- season

Training randomly masks 15 % of clay values and 10 % of tidal-range values as missing, so the model copes when SoilGrids or the Marine API are down.

The response also includes:

- **Crop damage.** An FAO / Maas–Hoffman threshold curve, using the same breakpoints as the web app, integrated over the predictive EC uncertainty.
- **Confidence.** The empirical precision of the predicted salinity class on the held-out period.

### Supply chain (`models/supply_chain_impact.py`)

A vectorised numpy Monte Carlo simulation with these steps:

- **Hazard.** Correlated hazard across regions (Gaussian copula) with sampled depth, duration and flooded area.
- **Crop damage.** Commodity damage curves calibrated so that rice flooded 5 days at 0.8 m loses about 80 %.
- **Logistics.** Logistics nodes can be disrupted, and trapped stock spoils.
- **Price.** An elasticity-based price impact plus commodity volatility.
- **Recovery.** Recovery time includes a re-planting lag.

### Advisor (`rag/`)

- **Knowledge base.** 34 markdown guides in `rag/knowledge/`, each with front-matter `source:` citing FAO, IRRI, CGIAR or national agencies. They are chunked by section.
- **Retrieval.** TF-IDF (1–2-grams) cosine similarity for the top 5 chunks, with country, crop and hazard boosts.
- **Generation.** The provider chain is `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `GROQ_API_KEY` → `OLLAMA_BASE_URL`. The prompt uses the spec §5.3 system prompt with the farmer's live numbers and the numbered passages.
- **Local fallback.** With no provider available, the **local grounded composer** (`provider: "local-grounded"`, not an LLM) builds the answer from the farmer's context compared against thresholds, plus actionable steps extracted from the retrieved passages, cited as [n].
- **Action cards.** Extracted from the final text.
- **Translation.** LLMs answer directly in the farmer's language. Composer output is translated with DeepL (if `DEEPL_API_KEY` is set) or MyMemory, in chunks of ≤ 480 characters with markdown preserved. Filipino maps to `tl`.

## Held-out metrics

The metrics below were computed on the test period (2024-01-01 → 2025-12-31), after training on 2019–2022 and validating on 2023. `model_weights/metrics.json` holds the full set.

Deployed versions: flood `v2.2.0`, salinity `v1.6.0`. These were promoted by `POST /api/ml/retrain` over `v2.1.0` / `v1.5.0`; a repeat retrain kept them.

**Dataset.** The panel covers 22 districts × 2,557 days (2019-01-01 → 2025-12-31), giving 56,254 district-days. It was built with about 9.2k Open-Meteo calls.

- `flood_dataset.csv.gz` is 645 KB.
- `salinity_dataset.csv.gz` is 420 KB.
- Training and evaluation used 56,188 rows (the last 3 days of each series have no complete look-ahead): 32,142 train, 8,030 val and 16,016 test.

**Flood ensemble.** Positive rate on test: 8.4 % (24 h), 10.0 % (48 h), 11.4 % (72 h).

| Horizon | AUC-ROC | F1 @ 0.5 | Brier | temporal-MLP AUC | HistGBM AUC | Persistence baseline AUC |
|---|---|---|---|---|---|---|
| 24 h | 0.982 | 0.811 | 0.022 | 0.975 | 0.988 | 0.891 |
| 48 h | 0.973 | 0.777 | 0.030 | 0.966 | 0.981 | 0.837 |
| 72 h | 0.969 | 0.756 | 0.036 | 0.962 | 0.974 | 0.800 |

- **Onset, 72 h** (days not already in flood; positive rate 4.7 %): AUC 0.936, F1 0.40, Brier 0.030.
- **Depth head:** RMSE 0.108 m, R² 0.55.
- **Blend weights** (MLP share for 24/48/72 h): 0.3 / 0.3 / 0.4.
- **Drift:** score PSI between test and train is 0.012.

**Salinity regressors** (EC in dS/m):

| Horizon | RMSE | MAE | R² | within ±20 % | class accuracy |
|---|---|---|---|---|---|
| now | 0.66 | 0.36 | 0.945 | 67 % | 90.5 % |
| +7 d | 0.71 | 0.38 | 0.936 | 67 % | 89.9 % |
| +30 d | 1.03 | 0.53 | 0.869 | 58 % | 85.5 % |
| +90 d | 1.44 | 0.69 | 0.708 | 52 % | 81.5 % |

The 30-day class precision, which is used as the API `confidence`, is 0.95 for safe, 0.53 for sensitive, 0.71 for moderate and 0.69 for severe.

**Training time.** Full training takes about 35–55 s on a 12-thread laptop, with OpenMP capped at 4 threads.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | localhost:3000/3001, agrishield.io | comma-separated or JSON list |
| `ML_API_KEY` | empty | protects `POST /api/ml/retrain` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | –, `claude-opus-5-5` | advisor provider 1 |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | –, `gpt-4o-mini` | provider 2 |
| `GROQ_API_KEY`, `GROQ_MODEL` | –, `llama-3.3-70b-versatile` | provider 3 (free tier) |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | –, `llama3.1:8b` | provider 4 (local open-source) |
| `DEEPL_API_KEY`, `MYMEMORY_EMAIL` | – | translation (MyMemory is key-less; an email raises its quota) |
| `MODEL_WEIGHTS_DIR` | `./model_weights` | weights and metrics |
| `TRAIN_ON_STARTUP` | `true` | background training when weights are missing |
| `LIVE_TIMEOUT_S` | `8` | per-request timeout for live data |

## Honest limitations

- **Flood labels are hydrological proxies, not observed inundation.** They mark GloFAS discharge exceedance and extreme 3-day rainfall. GloFAS is a 5 km model, and some delta districts snap to small creeks (for example Patuakhali and Jagatsinghpur). Satellite flood extents such as Sentinel-1 would be a better label.
- **Test AUC is high partly because of persistence.** A river that is already in flood tends to stay in flood. The **onset** metric counts only days that are not currently in flood and is the more decision-relevant number; both are reported, together with a persistence baseline.
- **Training forecasts are perfect-prognosis.** Training uses observed rain plus synthetic forecast error; live inference uses the Open-Meteo forecast, whose soil-moisture model also differs from ERA5-Land.
- **The salinity target is semi-synthetic.** It is driven by real discharge, rain, tides and soil, with levels calibrated to published ranges; the method is documented in `scripts/train-models/build_dataset.py`. No open multi-country EC archive exists. Plug in IoT or field EC measurements to recalibrate.
- **Supply-chain parameters are literature-informed, order-of-magnitude calibrations**, not fitted to transaction data.
- **The "temporal-MLP" is a feed-forward network over a fixed 10-day window**, not an LSTM.
- **The 22 districts cover 5 countries.** Points far from them rely on cell-search discharge climatology and a coast-distance prior, so they carry more uncertainty (see `degraded_inputs` and `site` in responses).

# Agri-SHIELD

**Climate decision intelligence for the farmers, governments and supply chains of Asia's deltas.**

Agri-SHIELD turns live climate data into role-specific, actionable decisions about the two slow- and fast-moving threats that destroy the most crops in South and Southeast Asia: **flooding** and **saltwater intrusion**. It covers 22 districts across five of the most exposed regions: the Ganges–Brahmaputra delta (Bangladesh), the Mekong Delta (Vietnam), Central Luzon (Philippines), the Odisha coast (India) and the Java north coast (Indonesia).

> Act before the flood hits. Save before the salt spreads.

Built by **Nitya Prakash Pandey** for the Asian Hackathon for Green Future 2026 (Water Resources & Climate-Resilient Agriculture track).

---

## What it does

Agri-SHIELD is a multi-tenant SaaS platform. Each customer organisation gets its own **workspace** (`/app`) tailored to its industry, plus dedicated portals for farmers and governments.

| Module | For | What it does |
| --- | --- | --- |
| **Risk Explorer** (`/app/explorer`, public `/explore`) | Everyone | Climate due-diligence for **any place on Earth**: ML flood & salinity models, 51-member ensemble forecast, 6-month seasonal outlook, 40-year ERA5 trends and return periods, SPI drought, heat stress, CMIP6 2050 projection, river percentiles, terrain & soil. Live radar, NASA observed-flood, JRC surface-water and 30 m satellite overlays; compare sites, PDF reports, share links |
| **Portfolio** (`/app/portfolio`) | Insurers, banks, agribusiness, NGOs, co-ops | Import assets (CSV/GeoJSON/address), hourly live re-scoring, value-at-risk by hazard, top movers, concentration, asset pages with satellite imagery |
| **Alerts & Rules** (`/app/alerts`) | All workspaces | Visual IF/THEN rule builder with dry-run; in-app, email, SMS, WhatsApp, signed webhooks and Slack; realtime notification centre |
| **Insurance** (`/app/insurance`) | Agri insurers | Parametric product designer **backtested on 30+ years of real weather and river data** with basis-risk checks, live trigger monitor, claims validation from satellite and reanalysis evidence, PML and reinsurance layers |
| **Lending & Finance** (`/app/finance`) | Banks, MFIs | Climate-adjusted PD / LGD / expected loss per loan with plain-language drivers, stress tests (1-in-50 flood, drought, salinity, 2050), TCFD / IFRS S2 physical-risk disclosure |
| **Anticipatory Action** (`/app/anticipatory`) | NGOs, governments | Forecast-based trigger protocols, historical backtest (hit rate, false alarms, lead time), pre-arranged cash planning and activation workflow |
| **Copilot** (`/app/copilot`, ⌘/Ctrl+J anywhere) | All workspaces | Ask questions in plain language; answers come from the workspace's own data as text, tables, maps and charts |
| **Reports & Settings** | All workspaces | Board packs, disclosures and digests (PDF, scheduled); team invites, roles, plans & usage limits, API keys, webhooks, audit log |
| **Farmer app** (`/dashboard/farmer`) | Smallholders (mobile PWA, 8 languages) | Risk gauges, FAO-56 irrigation scheduler, seasonal planting planner, **real WFP market prices**, crop doctor, farm ledger & insurance enrolment, live radar, AI advisor with voice, ask-an-officer, offline mode |
| **Government command** (`/dashboard/government`) | Ministries, district officers | Live district risk map on real admin boundaries, resource dispatch, early-warning broadcasts, analytics & PDF reports, policy and budget tools, farmer questions inbox |
| **Supply-chain intelligence** (`/dashboard/supply-chain`) | Traders, millers, logistics | Network risk, commodity risk with World Bank prices, Monte Carlo disruption scenarios, procurement alternatives |
| **Mission control** (`/admin`) | Platform operators | Tenants, models & drift, data-source health, jobs, scenario drills, billing, flags, outbox, SMS simulator |

Public site: industry solution pages, ROI calculator, capability comparison, demo booking, pricing with Business/Enterprise workspace plans, help centre with a 77-term plain-language glossary, `/status`, `/changelog`, `/trust`, `/docs`.

Farmers with feature phones can use the **SMS bot** (`STATUS`, `ALERT`, `ADVICE`, `HELP`, `LANG bn`, plus local-language keywords).

## Real data, no paid keys

Everything runs end to end on free and open data sources. Every number in the UI carries a source tag.

| Source | Used for |
| --- | --- |
| [Open-Meteo](https://open-meteo.com) forecast, ERA5 archive, elevation, marine, geocoding (CC BY 4.0) | Hourly rain, soil moisture, temperature, historical weather, sea level (tidal salinity push), terrain |
| Copernicus **GloFAS v4** via the Open-Meteo Flood API | River discharge forecasts and history |
| **NASA EONET** and **GDACS** (UN/EC JRC) | Live floods and cyclones across Asia-Pacific |
| **NASA GIBS**: MODIS true colour, MODIS NDVI, GPM IMERG | Satellite basemaps and the rainfall overlay |
| **ORNL DAAC MODIS** subsets (MOD13Q1) | Per-district 250 m NDVI for field crop-health and stress detection |
| ISRIC **SoilGrids** 2.0 (CC BY 4.0) | Soil clay and texture |
| OpenStreetMap / Overpass (ODbL), Esri basemaps | Rivers and canals near farms, map tiles |
| **World Bank** Open Data & Pink Sheet (CC BY 4.0) | Crop production context, monthly commodity prices |
| **WFP** food prices via HDX | Local market prices for farmers |
| Open-Meteo ensemble, seasonal (ECMWF SEAS5) & CMIP6 climate APIs | Forecast uncertainty, 6-month outlook, 2050 projections |
| RainViewer, NASA MODIS flood, JRC Global Surface Water, NASA HLS | Live radar, observed flood extent, 40-year water history, 30 m imagery |
| geoBoundaries (CC BY 3.0 IGO / ODbL / PD by country) | Real district boundaries |
| MyMemory (free) or DeepL | Translating alerts and advisor answers |

Optional integrations switch on when you add keys: an LLM provider for the advisor, Twilio SMS/WhatsApp, Resend email, Stripe/Razorpay billing, DeepL, and Postgres/Redis. See [`.env.example`](.env.example).

## Machine learning

The ML service (`apps/ml-api`, FastAPI) trains on **7 years of real ERA5 reanalysis and GloFAS river discharge** for all 22 districts (56k district-days). Flood labels come from observed discharge exceedances.

| Model | Held-out test (2024–25) |
| --- | --- |
| Flood ensemble (temporal MLP + gradient boosting, bootstrap uncertainty, depth head) | AUC 0.97 at 72 h, Brier 0.036, F1 0.76 |
| Salinity EC regressor (now / +7 / +30 / +90 days) | R² 0.87 at +30 days, RMSE 1.03 dS/m |
| Supply-chain impact | Monte Carlo (2,000 sims) with FAO crop-loss curves |
| AI advisor | Retrieval over 34 agronomy documents (FAO, IRRI, national extension guides), pluggable LLM, grounded local composer as fallback |

Champion/challenger retraining promotes a new model only if it beats the deployed one. Methodology and honest limitations are in [`apps/ml-api/README.md`](apps/ml-api/README.md) and the in-app docs at `/docs/methodology-flood` and `/docs/methodology-salinity`. For example, the salinity target is semi-synthetic because no free API offers salinity ground truth.

The web app degrades gracefully. If the ML service is down, it scores risk with the same physics-based formulas directly on live Open-Meteo/GloFAS data.

## Architecture

```
apps/
  web/        Next.js 15 (App Router, React 19) · tRPC v11 · NextAuth v5 · Tailwind · Framer Motion
              Leaflet · Recharts · d3 · three.js · Socket.io + SSE realtime · PWA service worker
  ml-api/     FastAPI · scikit-learn · numpy/pandas · TF-IDF RAG · live open-data features
packages/
  db/         Drizzle ORM schema for Postgres 16 + PostGIS (30 tables), migrations, RLS policies
  types/      Shared TypeScript domain types
  i18n/       en · hi · bn · vi · fil · id · ta · si (462 keys each)
scripts/      Postgres seeding, icon generation, ML dataset build & training
docs/         Product specification
```

- **Demo store.** A deterministic in-memory dataset grounded in real data (real district boundaries, ~590 real 2019–2026 flood episodes, World Bank prices, census-based farm sizes, land-validated coordinates; see `apps/web/server/data/real/README.md`) acts as the system of record in demo mode: 6 tenant workspaces, 457 monitored assets, 50 farmers, 20 supply-chain nodes. Live climate data is layered over it. `pnpm db:setup` provisions the equivalent Postgres/PostGIS database with row-level security.
- **Background jobs.** A climate scan runs every 30 min and raises alerts from model output. Satellite NDVI ingest runs daily, notification retries every few minutes, and model retraining weekly. Jobs use an in-process scheduler, or BullMQ when `REDIS_URL` is set.
- **Security.** RBAC with 7 roles, Zod validation on every input, rate limiting, strict CSP/HSTS headers, HMAC-signed webhooks, API keys stored as hashes, and an audit log. See `/docs/security`.

## Getting started

Prerequisites: Node.js 20+, pnpm 9+, Python 3.11+.

```bash
pnpm install

# 1. ML service (optional but recommended). Loads trained weights or retrains from the bundled dataset in ~1 min.
cd apps/ml-api && pip install -r requirements.txt && cd ../..
pnpm dev:ml                      # http://localhost:8000/docs

# 2. Web app
pnpm dev:web                     # http://localhost:3000
# or, with the Socket.io realtime server:
pnpm dev:realtime
```

No `.env` is required. Copy `.env.example` to `.env` to enable optional integrations.

> **Data quotas.** The free Open-Meteo tier allows ~10,000 location-calls per day per IP. Agri-SHIELD budgets its scheduled refreshes to stay within it, pauses a provider after HTTP 429 and serves cached or climatological values meanwhile. For production scale set `OPEN_METEO_API_KEY` (commercial tier); the platform switches endpoints automatically and refreshes faster.

### Demo accounts

All use password `demo2026` except the farmer (OTP `123456`). The sign-in page has one-click buttons for each.

| Workspace | Sign in | What you'll see |
| --- | --- | --- |
| Agri insurer — Delta Mutual | `insurer@demo.agrishield.io` | 140 group-policy units (~44,500 farmers, $23M insured), parametric designer & claims |
| Rural bank — MRCB | `bank@demo.agrishield.io` | 160 agri loans, climate-adjusted credit risk, stress tests |
| NGO — Delta Resilience Foundation | `ngo@demo.agrishield.io` | 48 coastal communities, anticipatory-action triggers |
| Farmer co-operative — Mahanadi FPC | `coop@demo.agrishield.io` | 90 member farms on the Odisha coast |
| Agribusiness — AsiaGrain | `supply@demo.agrishield.io` | Supply-chain portal + workspace |
| Government | `gov@demo.agrishield.io` | National operations centre (Bangladesh) |
| Farmer | `farmer@demo.agrishield.io` | Mobile farmer app (OTP `123456`) |
| Platform admin | `admin@demo.agrishield.io` | Mission control |

New organisations can sign up at `/auth/signup` → *Organisation workspace* (14-day Business trial).

The sign-in page also has one-click demo buttons. Press **Ctrl/⌘ + K** anywhere for the command palette.

### Scenario drills

Real weather is often calm. To see the platform under stress, open **Admin → Scenario Control** and switch from *Live* to *Monsoon surge*, *Cyclone landfall* or *Dry-season salinity*. The drill is injected on top of live observations, and the climate scan then raises alerts, dispatch needs and supply-chain disruptions exactly as it would in a real event.

### Optional: Postgres + Redis

```bash
docker compose up -d postgres redis
pnpm db:setup                    # migrate + RLS policies + seed (incl. 90 days of ERA5 readings)
```

## Testing

```bash
pnpm --filter @agri-shield/web test        # 443 Vitest unit/integration tests
pnpm test:ml                               # 68 pytest tests (models, API, RAG, Monte Carlo)
pnpm --filter @agri-shield/web test:e2e    # Playwright: farmer, government, admin, landing, PWA flows
```

CI (`.github/workflows/ci.yml`) runs the type-check, both test suites, a production build and the Docker image build on every push.

## API

- REST: `/api/v1/risk`, `/api/v1/health`, `/api/v1/sms/inbound`, `/api/v1/alerts/webhook`, `/api/v1/supply-chain/commodity-risk`. The OpenAPI 3.1 spec is at `/api/v1/openapi.json`.
- ML: `/api/ml/flood-risk`, `/salinity-risk`, `/advisor`, `/supply-chain/scenario`, `/metrics`, `/retrain`. Interactive docs are at `:8000/docs`.
- Full reference and integration guide (webhook signature verification in Node and Python) are in-app at `/docs`.

## Deployment

`vercel.json` (web), `apps/web/Dockerfile`, `apps/ml-api/Dockerfile`, `docker-compose.yml` and `.github/workflows/deploy.yml` (Vercel + Railway, gated on secrets) are included.

## Author

**Nitya Prakash Pandey**, product, design, engineering and ML.

## License

[MIT](LICENSE) © 2026 Nitya Prakash Pandey

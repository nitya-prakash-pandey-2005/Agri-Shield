# Agri-SHIELD

**Climate decision intelligence for the farmers, governments and supply chains of Asia's deltas.**

Agri-SHIELD turns live climate data into role-specific, actionable decisions about the two slow- and fast-moving threats that destroy the most crops in South and Southeast Asia: **flooding** and **saltwater intrusion**. It covers 22 districts across five of the most exposed regions: the Ganges–Brahmaputra delta (Bangladesh), the Mekong Delta (Vietnam), Central Luzon (Philippines), the Odisha coast (India) and the Java north coast (Indonesia).

> Act before the flood hits. Save before the salt spreads.

Built by **Nitya Prakash Pandey** for the Asian Hackathon for Green Future 2026 (Water Resources & Climate-Resilient Agriculture track).

---

## What it does

| Portal | For | Highlights |
| --- | --- | --- |
| **Farmer app** (`/dashboard/farmer`) | Smallholder farmers, mobile-first PWA | Flood & salinity gauges for *their* fields, 72-hour rain/flood strip, real MODIS NDVI crop health, alert centre with 3-tap actions, AI farm advisor with voice input, offline mode, 8 languages |
| **Government command** (`/dashboard/government`) | Agriculture ministries & district officers | Live district risk map, drill-down, resource dispatch workflow, early-warning wizard with multi-channel previews, auto-escalation, analytics and PDF ministry reports, policy and budget planner |
| **Supply-chain intelligence** (`/dashboard/supply-chain`) | Traders, millers, logistics | Network risk map, commodity risk tracker, Monte Carlo disruption scenarios with impact cascades, alternative-supplier procurement, signed webhooks and API keys |
| **Mission control** (`/admin`) | Platform operators | Users & org verification, model metrics & drift, open-data source health, jobs, scenario drills, audit log, billing, feature flags, notification outbox, SMS simulator |

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
| **World Bank** Open Data (CC BY 4.0) | Crop production context |
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

- **Demo store.** A deterministic in-memory dataset (50 farmers, ~150 fields, 205 alerts, 20 supply-chain nodes) acts as the system of record in demo mode, with live climate data layered over it. `pnpm db:setup` provisions the equivalent Postgres/PostGIS database with row-level security.
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

### Demo accounts

| Role | Sign in | Credentials |
| --- | --- | --- |
| Farmer | `farmer@demo.agrishield.io` | OTP `123456` |
| Government (national admin) | `gov@demo.agrishield.io` | `demo2026` |
| Supply chain | `supply@demo.agrishield.io` | `demo2026` |
| Platform admin | `admin@demo.agrishield.io` | `demo2026` |

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
pnpm --filter @agri-shield/web test        # 168 Vitest unit/integration tests
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

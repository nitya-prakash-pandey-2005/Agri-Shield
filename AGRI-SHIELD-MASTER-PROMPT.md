# 🌾 AGRI-SHIELD — MASTER AGENT BUILD PROMPT
### AI-Powered Climate Decision Intelligence Platform
#### Production-Level · Hackathon-Winner Grade · Deployment-Ready
---

> **Context for the Agent:** You are building Agri-SHIELD — a world-class, production-grade, AI-powered Climate Decision Intelligence Platform. This is a real SaaS product targeting real revenue, built to win the Asian Hackathon for Green Future 2026 (Water Resources & Climate-Resilient Agriculture track). It must be jaw-droppingly beautiful, technically unassailable, and immediately usable by farmers, government officials, and supply chain operators across Asia. Build every single feature described below to production standard. Leave nothing as a stub or placeholder. Every screen must be pixel-perfect, every API must work, every ML inference must return real output.

---

## 0. NORTH STAR MISSION

Agri-SHIELD transforms climate forecasts into **role-specific, real-time, actionable intelligence** for three stakeholder groups:
1. **Farmers** — know what's coming, what to do, and when to act
2. **Governments** — coordinate disaster resources before the disaster hits
3. **Supply Chains** — reroute, restock, and hedge before disruption arrives

The two primary climate threats are **saltwater intrusion** (slow-onset, soil-salinity creep) and **flooding** (flash + riverine + coastal surge). Every feature must connect back to reducing crop loss, protecting livelihoods, and enabling proactive — not reactive — decision-making.

---

## 1. TECH STACK (Non-Negotiable, Production Grade)

### Frontend
- **Framework:** Next.js 14+ (App Router, React Server Components)
- **Styling:** Tailwind CSS 3.4+ with a custom design system (CSS variables, dark/light mode)
- **UI Components:** shadcn/ui + Radix UI primitives
- **Maps:** Mapbox GL JS (satellite + vector layers) — fallback to Leaflet.js
- **Charts & Data Viz:** Recharts + D3.js for custom SVG overlays
- **Animation:** Framer Motion for page transitions, micro-interactions, loading states
- **3D Globe:** Three.js / react-three-fiber for landing page globe visualization
- **State Management:** Zustand + React Query (TanStack Query v5)
- **Forms:** React Hook Form + Zod validation
- **Internationalization:** next-intl (support: English, Hindi, Bengali, Vietnamese, Tagalog, Bahasa Indonesia, Tamil, Sinhala)
- **PWA:** next-pwa for offline capability on the farmer mobile app
- **Push Notifications:** Web Push API + Firebase Cloud Messaging
- **Real-time:** Socket.io client for live dashboard updates

### Backend
- **Runtime:** Node.js 20 LTS with TypeScript
- **Framework:** Express.js + tRPC for type-safe API layer
- **Alternative:** FastAPI (Python) for all ML inference endpoints
- **Auth:** NextAuth.js v5 (OAuth2 + Magic Link + OTP SMS via Twilio)
- **Database (Primary):** PostgreSQL 16 via Supabase (PostGIS extension for spatial queries)
- **Database (Time-Series):** TimescaleDB for sensor data + climate readings
- **Database (Cache):** Redis 7 (Upstash) for alert caching + rate limiting
- **Database (Vector):** pgvector for RAG embeddings
- **Object Storage:** Supabase Storage / AWS S3 for satellite image tiles
- **Queue:** BullMQ (Redis-backed) for async ML jobs
- **WebSockets:** Socket.io for real-time dashboard + alerts

### ML & AI Layer
- **Runtime:** Python 3.11 + FastAPI
- **Flood Prediction Model:** LSTM + Transformer hybrid trained on CHIRPS rainfall + USGS streamflow data
- **Salinity Intrusion Model:** Random Forest + XGBoost ensemble on soil EC sensor + satellite NDWI/NDSI indices
- **Crop Risk Scoring:** Gradient Boosting (LightGBM) on crop type × climate risk × soil health matrix
- **Supply Chain Impact Predictor:** Time-series forecasting (Prophet + custom LSTM) on commodity price × flood zone overlap
- **Recommendation Engine:** RAG pipeline using LangChain + GPT-4o / Claude 3.5 Sonnet for natural language advisory
- **Satellite Processing:** Google Earth Engine Python API (NDVI, NDWI, SAR flood mapping via Sentinel-1)
- **Model Serving:** BentoML or FastAPI with model versioning
- **Experiment Tracking:** MLflow

### External APIs & Data Sources
- **Satellite Imagery:** NASA Earthdata (Sentinel-2, Landsat-9), Google Earth Engine, Copernicus Open Access Hub
- **Weather Forecasting:** OpenWeatherMap API (hourly + 16-day), NOAA GFS (free), Open-Meteo API
- **Flood Data:** Google Flood Forecasting API (100+ countries), Ambee Flood API, GloFAS (Copernicus)
- **Soil Data:** SoilGrids 2.0 API (ISRIC), FAO GAEZ database
- **Crop Calendar:** FAO GAEZ + USDA IPAD crop calendar API
- **Ocean / Sea Level:** CMEMS (Copernicus Marine) for coastal salinity data
- **IoT Sensor Ingest:** MQTT broker (Mosquitto) → Node.js consumer → TimescaleDB
- **SMS Alerts:** Twilio SMS + WhatsApp Business API
- **Translation AI:** DeepL API + Google Cloud Translation for dynamic multilingual content
- **Mapping Tiles:** Mapbox Satellite + OpenStreetMap via Mapbox

### Infrastructure & DevOps
- **Hosting Frontend:** Vercel (Edge Functions + CDN)
- **Hosting Backend:** Railway.app or Render.com (auto-scale containers)
- **ML Inference:** Modal.com (GPU serverless) or Hugging Face Inference Endpoints
- **Database:** Supabase (managed PostgreSQL + auth + realtime + storage)
- **CI/CD:** GitHub Actions (lint → test → build → deploy pipeline)
- **Monitoring:** Sentry (error tracking) + Vercel Analytics + PostHog (product analytics)
- **Logging:** Pino logger → Logtail / Better Stack
- **Environment:** Docker + docker-compose for local dev; production containers via Railway
- **Secrets:** Doppler or Vercel Environment Variables
- **Domain:** Custom domain with SSL (Let's Encrypt via Vercel)

---

## 2. REPOSITORY STRUCTURE

Build as a **monorepo** using Turborepo:

```
agri-shield/
├── apps/
│   ├── web/                    # Next.js 14 main platform
│   ├── mobile/                 # PWA farmer app (same Next.js, mobile-optimized routes)
│   └── ml-api/                 # FastAPI Python ML inference server
├── packages/
│   ├── ui/                     # Shared shadcn/ui component library
│   ├── db/                     # Drizzle ORM schema + migrations
│   ├── types/                  # Shared TypeScript types
│   ├── config/                 # ESLint, Prettier, Tailwind config
│   └── utils/                  # Shared utility functions
├── scripts/
│   ├── seed.ts                 # Database seeding with realistic demo data
│   └── train-models/           # ML training scripts
├── docs/                       # Architecture docs, API docs
├── .github/workflows/          # CI/CD pipelines
├── docker-compose.yml
├── turbo.json
└── README.md
```

---

## 3. DATABASE SCHEMA (PostgreSQL + PostGIS + TimescaleDB)

Create ALL of the following tables with proper indexes, foreign keys, RLS policies (Supabase), and TypeScript types via Drizzle ORM:

### Core Tables
```sql
-- Users with role-based access
users (id, email, name, role ENUM['farmer','government','supply_chain','admin'], 
       language, phone, created_at, last_active, subscription_tier)

-- Organization accounts (government agencies, supply chain companies)
organizations (id, name, type, country, region, verified, plan_tier)

-- User ↔ Organization mapping
user_organizations (user_id, org_id, role_in_org, permissions JSONB)

-- Farmer profiles
farmer_profiles (id, user_id, farm_name, total_area_ha, 
                 primary_crops TEXT[], experience_years,
                 location GEOMETRY(Point, 4326), district, country)

-- Farm fields with spatial geometry
farm_fields (id, farmer_id, name, area_ha, crop_type, planting_date,
             expected_harvest, soil_type, irrigation_type,
             geometry GEOMETRY(Polygon, 4326), elevation_m)

-- Government regions
government_regions (id, org_id, name, admin_level ENUM['national','provincial','district'],
                   geometry GEOMETRY(MultiPolygon, 4326), population, 
                   vulnerable_area_ha, total_farms INTEGER)

-- Supply chain entities
supply_chain_nodes (id, org_id, type ENUM['warehouse','port','processor','retailer'],
                    location GEOMETRY(Point, 4326), capacity_tonnes,
                    primary_commodities TEXT[], risk_score FLOAT)
```

### Climate & Risk Data Tables
```sql
-- Hyper-local weather readings (time-series, TimescaleDB)
weather_readings (time TIMESTAMPTZ NOT NULL, station_id UUID,
                  location GEOMETRY(Point, 4326),
                  temperature_c FLOAT, humidity_pct FLOAT,
                  rainfall_mm FLOAT, wind_speed_kmh FLOAT,
                  soil_moisture_pct FLOAT, water_level_m FLOAT,
                  salinity_ec_ds_m FLOAT)

-- SELECT create_hypertable('weather_readings', 'time');

-- Flood risk assessments
flood_risk_zones (id, region_id, geometry GEOMETRY(Polygon, 4326),
                  risk_level ENUM['low','medium','high','critical'],
                  flood_probability_7d FLOAT, flood_probability_24h FLOAT,
                  estimated_depth_m FLOAT, last_updated TIMESTAMPTZ,
                  model_version VARCHAR, confidence_score FLOAT)

-- Salinity intrusion maps
salinity_risk_zones (id, region_id, geometry GEOMETRY(Polygon, 4326),
                     ec_current_ds_m FLOAT, ec_predicted_30d FLOAT,
                     intrusion_depth_km FLOAT, risk_level TEXT,
                     affected_area_ha FLOAT, last_updated TIMESTAMPTZ)

-- Climate forecasts cache
climate_forecasts (id, location GEOMETRY(Point, 4326), forecast_date DATE,
                   source VARCHAR, raw_data JSONB, processed_at TIMESTAMPTZ)

-- Satellite imagery metadata
satellite_scenes (id, satellite VARCHAR, scene_date DATE,
                  cloud_cover_pct FLOAT, bands JSONB,
                  geometry GEOMETRY(Polygon, 4326),
                  ndvi_mean FLOAT, ndwi_mean FLOAT,
                  storage_url TEXT, processed BOOLEAN)
```

### Alerts & Recommendations Tables
```sql
-- System-generated alerts
climate_alerts (id, alert_type ENUM['flood','salinity','drought','storm','frost'],
                severity ENUM['watch','warning','emergency'],
                region_id UUID, geometry GEOMETRY(Polygon, 4326),
                title TEXT, description TEXT,
                predicted_impact JSONB,
                recommended_actions JSONB,
                valid_from TIMESTAMPTZ, valid_until TIMESTAMPTZ,
                created_at TIMESTAMPTZ, is_active BOOLEAN)

-- Alert deliveries (who got notified and how)
alert_deliveries (id, alert_id, user_id, channel ENUM['app','sms','whatsapp','email'],
                  delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, actioned BOOLEAN)

-- AI-generated farm-specific recommendations
farm_recommendations (id, farm_field_id, alert_id,
                      recommendation_type VARCHAR,
                      title TEXT, description TEXT,
                      priority ENUM['low','medium','high','urgent'],
                      actions JSONB,
                      confidence_score FLOAT,
                      generated_by VARCHAR,
                      created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
                      farmer_feedback TEXT, outcome_recorded BOOLEAN)

-- Government resource allocation
resource_requests (id, org_id, requested_by UUID,
                   resource_type ENUM['pumps','sandbags','evacuation_buses','medical','food_aid'],
                   quantity INTEGER, target_region UUID,
                   status ENUM['pending','approved','dispatched','delivered'],
                   priority TEXT, notes TEXT,
                   approved_by UUID, approved_at TIMESTAMPTZ)

-- Supply chain disruption forecasts
supply_chain_risks (id, node_id, commodity VARCHAR,
                    risk_type ENUM['flood_disruption','salinity_quality','access_blocked','storage_damaged'],
                    probability FLOAT, estimated_loss_tonnes FLOAT,
                    estimated_loss_usd FLOAT,
                    mitigation_options JSONB,
                    valid_from DATE, valid_to DATE)
```

### Analytics & Feedback Tables
```sql
-- Farmer action logs (did they follow recommendations?)
farmer_actions (id, farmer_id, recommendation_id, action_taken TEXT,
                action_date TIMESTAMPTZ, outcome TEXT, crop_saved_pct FLOAT)

-- Platform usage analytics
usage_events (id, user_id, event_type VARCHAR, properties JSONB,
              session_id UUID, created_at TIMESTAMPTZ)

-- Subscription plans
subscriptions (id, user_id, org_id, plan ENUM['free','farmer_pro','gov_basic','gov_enterprise','supply_chain'],
               status ENUM['active','past_due','cancelled'],
               current_period_start DATE, current_period_end DATE,
               stripe_subscription_id TEXT)
```

---

## 4. APPLICATION PAGES & SCREENS (Build Every Single One)

### 4.1 Public Landing Page (`/`)

Build a cinematic, award-winning landing page. Full-viewport sections:

**Hero Section:**
- Animated 3D globe (Three.js) showing Asia with pulsing flood risk overlays and animated salinity creep lines
- Headline: "Act Before the Flood Hits. Save Before the Salt Spreads."
- Sub-headline: "Agri-SHIELD turns climate data into decisions — for farmers, governments, and supply chains across Asia."
- Two CTAs: "Start Free for Farmers" (green) + "Request Government Demo" (dark outline)
- Live counter widget: "X farmers protected today | Y alerts sent this week | Z ha of farmland monitored"
- Auto-refreshing stats pulled from the API

**Problem Section:**
- Split-screen animated infographic: Left shows what happens WITHOUT Agri-SHIELD (reactive, loss, chaos), right shows WITH Agri-SHIELD (proactive, saved, coordinated)
- Stat callouts: "$27B annual loss from saltwater intrusion globally", "72hr advance warning window", "3 stakeholders, 1 platform"

**How It Works Section:**
- Animated 4-step pipeline: Satellite Data → ML Processing → Role-Specific Intelligence → Action
- Each step expands on hover with technical detail

**Three Portals Section:**
- Three beautifully designed cards, each showing a mockup of the respective dashboard
- Farmer Portal, Government Portal, Supply Chain Portal
- Hover animation reveals features list

**Live Demo Teaser Section:**
- Embed a non-auth interactive mini-map showing real flood risk data for Mekong Delta / Bay of Bengal / Philippine coasts
- Filter by risk type (flood / salinity)

**Testimonials & Impact Section:**
- Carousel of impact stories (seeded realistic data for demo)
- Stats: "15,000+ farmers onboarded", "23 government agencies", "₹450 Cr crop loss prevented (simulated)"

**Pricing Section:**
- Tiered cards: Free (Farmers), Farmer Pro (₹199/mo), Government Basic, Government Enterprise, Supply Chain
- Feature comparison matrix

**Footer:**
- Full navigation, social links, language switcher, trust badges (ISO, data security)

---

### 4.2 Authentication Pages

Build: `/auth/signin`, `/auth/signup`, `/auth/otp-verify`, `/auth/forgot-password`

- Role selection during signup: Farmer / Government Officer / Supply Chain Manager
- Phone OTP for farmers (Twilio) + Email magic link for orgs
- Language selection during onboarding
- If "Farmer" selected: redirect to farmer onboarding wizard
- If "Government": redirect to org onboarding + verification pending screen
- Beautiful gradient form cards, animated input validation, smooth transitions

---

### 4.3 Farmer Onboarding Wizard (`/onboarding/farmer`)

Multi-step wizard (5 steps) with progress bar:

**Step 1 — Personal Info:**
- Name, phone, district, country, years of experience
- Language preference (UI immediately switches)

**Step 2 — Farm Setup:**
- Farm name, total area (ha)
- Primary crops selector (multi-select grid with crop icons): Rice, Wheat, Maize, Sugarcane, Jute, Coconut, Vegetables, etc.

**Step 3 — Draw Your Fields:**
- Mapbox polygon drawing tool to draw farm field boundaries
- OR: manual GPS coordinate entry
- OR: detect current location and auto-outline (simplified)
- Each field: name, crop, planting date, irrigation type

**Step 4 — Risk Profile:**
- Questions: "Has your farm flooded before?" (Y/N + frequency) → sets baseline risk
- "Has your soil tasted salty or crops yellowed from salt?" → salinity flag
- "Do you have flood insurance?" → insurance recommendation trigger
- Distance to nearest river / coast (auto-detected via PostGIS query)

**Step 5 — Notification Preferences:**
- Which alerts: Flood warning / Salinity alert / Planting advice / Weather forecast
- Channels: App + SMS + WhatsApp (enter number) + Email
- Alert timing: Immediate / Daily digest / Weekly summary
- Threshold: Alert only when risk > [Low / Medium / High]

Completion: Beautiful success screen, confetti animation, show first 3 personalized recommendations immediately

---

### 4.4 Farmer Dashboard (`/dashboard/farmer`)

**Layout:** Mobile-first PWA. Bottom nav bar on mobile (Home / Map / Alerts / Advisor / Profile). Sidebar on desktop.

**Home Tab — My Farm Overview:**

Top card — "Your Farm Risk Status" with animated risk meter (gauge chart):
- Flood risk: [percentage] — [color coded ring]
- Salinity risk: [percentage] — [color coded ring]
- Weather today: temperature, humidity, rainfall, wind
- Last satellite scan: [date] — NDVI health score

Next 72-Hour Forecast strip (scrollable horizontal timeline):
- Hour-by-hour rainfall probability bars
- Water level trend line
- Salinity intrusion trend arrow

Active Alerts card (if any):
- Color-coded alert cards (red = emergency, orange = warning, yellow = watch)
- Each card: alert type, what it means for their farm, countdown timer, 3-tap action button

My Fields grid:
- Card per field: field name, crop, health status (from NDVI), days to harvest, current risk level
- Tap to expand: full field detail, satellite view thumbnail, field-specific recommendations

**Map Tab — Live Climate Map:**
- Full-screen Mapbox map centered on farmer's location
- Layer toggles: Flood Risk Heatmap / Salinity Intrusion / NDVI (crop health) / Rainfall / Water Bodies
- Their farm fields drawn as polygons with color coded risk overlay
- Tap any zone for popup: risk level, timeline, what it means
- Satellite imagery toggle (Sentinel-2 last 7 days)
- Timeline slider: scrub through 7-day forecast OR 30-day historical

**Alerts Tab — Alert Center:**
- All alerts sorted by severity + recency
- Filter: All / Flood / Salinity / Weather / Advisory
- Each alert: severity badge, description (in their language), time remaining, recommended actions as checkbox list
- "Mark as Actioned" button → logs farmer action for outcome tracking
- Archived alerts with outcomes

**Advisor Tab — AI Farm Advisor (RAG-powered):**
- Chat interface with "Agri-SHIELD AI Advisor"
- Context-aware: AI knows their crops, soil type, field geometry, current risk level
- Pre-built quick prompts: "What should I do about the flood warning?", "Is it safe to plant now?", "What crop should I grow on salt-affected land?"
- Voice input button (Web Speech API) for farmers who prefer speaking
- Responses in their chosen language
- AI cites sources: "Based on your soil EC of 3.2 dS/m and 48hr flood probability of 78%..."
- Action cards appear below AI response: "Schedule irrigation flush", "Contact extension officer", "Apply for crop insurance"

**Profile Tab:**
- Edit farm details
- Manage notification preferences
- Subscription status + upgrade CTA
- Download my data (CSV export of all readings + alerts)
- Referral program (invite neighboring farmers → unlock premium features)

---

### 4.5 Government Dashboard (`/dashboard/government`)

**Layout:** Desktop-first. Full sidebar navigation. Dark professional theme with emerald green accents.

**Overview Page:**

Top KPI row (animated counters):
- Total monitored area (ha)
- Active high-risk zones
- Farmers in alert zones
- Resources dispatched today
- Alerts sent this week
- Estimated crop loss (if no action)

**Main Map Panel:**
- Mapbox full-panel map with admin region overlays
- Layer switcher: Flood Risk / Salinity Intrusion / Farmer Density / Resource Allocation / Historical Events
- Region polygons colored by risk level with hover tooltips
- Click any district → drill down panel appears on right

**Drill-Down District Panel (right sidebar on map click):**
- District name, admin level, risk level badge
- Flood probability 24h / 48h / 72h timeline bar
- Farmers at risk count (linked to farmer DB by geo query)
- Resources needed vs. available (sandbags, pumps, evacuation capacity)
- One-click "Dispatch Resources" button → opens resource request modal
- Recent alerts for this district
- Historical flood events with damage reports

**Resource Management Page (`/dashboard/government/resources`):**
- Inventory table: resource type, quantity available, quantity deployed, locations
- Map view: resource depot pins, coverage radius circles
- Request queue: incoming requests from district officers, approve/reject/modify
- Dispatch workflow: select resources → select destination → assign vehicle → confirm
- Real-time status tracking: Pending → Approved → Dispatched → Delivered
- Shortage alerts: "WARNING: Pump inventory at 12% — 340 farms in high-risk zones require pumps"

**Early Warning Management (`/dashboard/government/alerts`):**
- Alert creation wizard: select alert type → define geography (draw on map / select districts) → set severity → write message → select notification channels → schedule or send now
- Alert templates library (pre-built for flood, cyclone, salinity emergency)
- Broadcast history: all sent alerts with delivery receipts, read rates
- Multi-channel preview: see exactly how the alert appears in App / SMS / WhatsApp before sending
- Escalation rules: auto-escalate severity if risk threshold is crossed at T+6h

**Analytics & Reporting (`/dashboard/government/analytics`):**
- Season-over-season crop loss comparison (with vs. without early warning)
- Alert response rate: what % of farmers took action after alert
- Resource utilization heatmap
- Hotspot analysis: which districts flood most, trend over years
- Export: PDF report builder for ministry submissions

**Policy Recommendations Page:**
- AI-generated policy briefs: "Based on Q3 2026 salinity data, we recommend investing in embankment reinforcement in [3 districts]..."
- Infrastructure gap analysis: where sensor networks are missing
- Budget planning tool: cost of inaction vs. cost of proactive investment

---

### 4.6 Supply Chain Dashboard (`/dashboard/supply-chain`)

**Layout:** Desktop. Clean corporate design. Navy + amber palette.

**Risk Overview:**
- Network map: all supply chain nodes (warehouses, ports, processors) as pins
- Color coded by flood/salinity risk
- Connection lines showing commodity flows between nodes
- Risk scoring: each node has a composite risk score (0-100)

**Commodity Risk Tracker:**
- Table: commodity → producing regions → risk level → estimated supply disruption % → price impact forecast
- Risk timeline: 7 / 14 / 30 day forecast per commodity
- "At-risk harvest volume" calculated from farm field data in affected zones
- Historical comparison: "Similar flood events in 2022 caused 23% rice price spike in 3 weeks"

**Disruption Scenarios (`/dashboard/supply-chain/scenarios`):**
- Scenario modeler: "If flood hits Mekong Delta at Category 3 intensity for 5 days..."
- Impact cascades: which warehouses, which roads, which ports, which downstream buyers affected
- Monte Carlo confidence intervals on loss estimates
- Mitigation options: reroute to alternative supplier, pre-purchase forward contracts, build safety stock

**Procurement Intelligence:**
- Alternative supplier map: if primary region floods, nearest unaffected region that can supply same commodity
- Lead time estimates
- Quality flags: regions with known salinity issues → lower grain quality expected

**Alerts & API Webhook config:**
- Configure commodity + risk threshold → receive webhook to their ERP/logistics system
- API key management
- Integration docs preview

---

### 4.7 Admin Panel (`/admin`)

- User management (view, edit, suspend)
- Organization verification workflow
- Model performance dashboard: prediction accuracy, drift detection
- Data source health: API uptime, last successful satellite ingest
- Alert audit log
- Subscription + billing overview
- Feature flag management

---

## 5. ML MODELS — DETAILED SPECIFICATIONS

### 5.1 Flood Risk Prediction Model

**File:** `apps/ml-api/models/flood_predictor.py`

**Input Features:**
- 7-day rolling rainfall (CHIRPS API, 0.05° resolution)
- Current soil moisture (from ESA CCI or SoilGrids)
- River/canal distance (computed from PostGIS)
- Elevation (SRTM 30m DEM)
- Land cover type (ESA WorldCover)
- Historical flood frequency for the pixel (GLOFAS archive)
- Current water level at nearest gauge (where available)
- Tidal cycle (for coastal zones, from CMEMS)

**Model Architecture:**
- LSTM (64 units, 2 layers) takes the 7-day temporal sequence of rainfall + water level
- XGBoost takes static features (elevation, distance, land cover, historical freq)
- Ensemble: weighted average of LSTM probability + XGBoost probability
- Output: flood probability for 24h, 48h, 72h windows + estimated water depth (regression head)
- Uncertainty: Monte Carlo Dropout on LSTM, output confidence intervals

**Training Data:**
- GLOFAS historical flood events 2000-2024 for South/Southeast Asia
- Labels: binary flood / no-flood at 0.1° grid cells
- Evaluation: AUC-ROC, F1 @ 0.5 threshold, Brier Score

**API Endpoint:**
```
POST /api/ml/flood-risk
Body: { lat, lon, forecast_days: 3 }
Response: {
  probability_24h: 0.82,
  probability_48h: 0.91,
  probability_72h: 0.95,
  estimated_depth_m: 0.8,
  confidence_interval: [0.6, 1.0],
  contributing_factors: ["above_avg_rainfall_7d", "high_soil_saturation", "spring_tide"],
  model_version: "v2.3.1"
}
```

---

### 5.2 Saltwater Intrusion Prediction Model

**File:** `apps/ml-api/models/salinity_predictor.py`

**Input Features:**
- Distance from coastline / tidal river
- Elevation (SRTM)
- Current sea level anomaly (CMEMS satellite altimetry)
- Rainfall last 30 days (dry soil = more vulnerable)
- Historical EC measurements (from IoT sensors, if available)
- Flood events in last 30 days (post-flood salinity risk)
- Soil type (clay content, organic matter from SoilGrids)
- Land use (mangrove buffer present? irrigation canal proximity?)

**Model:**
- LightGBM gradient boosting on above features
- Outputs: EC prediction (dS/m) for 7d / 30d / 90d
- Risk class: Safe (<2 dS/m) / Sensitive (2–4) / Moderate (4–8) / Severe (>8)
- Crop damage likelihood per crop type at predicted EC level

**Crop-Salinity Damage Lookup:**
```python
# EC tolerance thresholds (dS/m) — from FAO data
CROP_EC_THRESHOLDS = {
  "rice": {"sensitive": 3.0, "moderate": 6.0, "tolerant": 10.0},
  "wheat": {"sensitive": 6.0, "moderate": 9.0, "tolerant": 13.0},
  "sugarcane": {"sensitive": 1.7, "moderate": 3.4, "tolerant": 7.0},
  "coconut": {"sensitive": 5.0, "moderate": 8.0, "tolerant": 12.0},
}
```

**API Endpoint:**
```
POST /api/ml/salinity-risk
Body: { lat, lon, crop_type, prediction_horizon_days: 30 }
Response: {
  ec_current: 3.2,
  ec_predicted_7d: 4.1,
  ec_predicted_30d: 5.8,
  risk_level: "moderate",
  crop_damage_probability: 0.64,
  recommended_crops: ["barley", "sorghum", "salt-tolerant_soy"],
  mitigation_actions: ["freshwater_flush", "gypsum_application"],
  confidence: 0.78
}
```

---

### 5.3 AI Farm Advisor (RAG Pipeline)

**File:** `apps/ml-api/rag/advisor.py`

**Knowledge Base (embed and store in pgvector):**
- FAO crop management guides for South/Southeast Asia (PDF)
- USDA saltwater intrusion management guidelines
- Crop-specific flood response protocols
- Local government agricultural extension materials (per country)
- Historical case studies: "What did farmers in Mekong Delta do in 2020 floods?"

**RAG Pipeline:**
1. Receive user question + context (farmer profile, current risk data, location)
2. Embed question via `text-embedding-3-small`
3. Retrieve top 5 chunks from pgvector knowledge base
4. Build system prompt: `You are Agri-SHIELD's farm advisor. The farmer's name is {name}, they grow {crops} on {area}ha in {district}. Current flood risk is {risk}%. Current salinity EC is {ec} dS/m. Today's forecast: {forecast}.`
5. Call Claude 3.5 Sonnet or GPT-4o with RAG context
6. Post-process: extract action items, confidence level, sources cited
7. Translate if needed (DeepL API)
8. Return structured response with actions + sources

---

### 5.4 Supply Chain Impact Forecaster

**File:** `apps/ml-api/models/supply_chain_impact.py`

**Process:**
1. For each supply chain node, compute flood overlap with flood risk polygon (PostGIS `ST_Intersects`)
2. For each at-risk commodity, compute % of production area in high-risk flood zones
3. Apply commodity-specific impact functions: "Rice flooded for 5 days at 0.8m → 80% crop loss"
4. Aggregate by supply chain link: producer region → warehouse → processor → market
5. Output: disruption probability, volume loss estimate, estimated price impact %, recovery timeline
6. Use historical commodity price data (World Bank Pink Sheet API) to estimate price volatility

---

## 6. REAL-TIME INFRASTRUCTURE

### Alert Pipeline (Automated, No Human Required)

Build a background job system using BullMQ:

```
Job: CLIMATE_SCAN (runs every 30 minutes)
1. Fetch latest rainfall forecast (Open-Meteo API) for all monitored regions
2. Fetch latest flood data (Google Flood API) for Asia
3. Run flood_predictor.py on all farm_fields above threshold
4. Run salinity_predictor.py on coastal farm_fields
5. If risk > threshold AND no alert exists in last 6h:
   a. Create climate_alert record
   b. Generate farm_recommendations for all affected farmers via RAG
   c. Add to notification queue
6. Update flood_risk_zones and salinity_risk_zones tables
7. Push real-time update via Socket.io to all connected government dashboards

Job: NOTIFICATION_DISPATCH (processes notification queue)
1. For each pending alert delivery:
   - App push: FCM notification to farmer's device
   - SMS: Twilio SMS with short message in farmer's language
   - WhatsApp: Twilio WhatsApp with rich card (alert type, severity, 3 actions)
   - Email: Resend API with HTML email (for government officers)
2. Log delivery status + timestamp
3. Mark delivered

Job: SATELLITE_INGEST (runs daily at 02:00 UTC)
1. Query NASA Earthdata / Copernicus for new Sentinel-2 scenes
2. Filter by cloud cover < 20%, intersection with monitored regions
3. Compute NDVI, NDWI for each farm_field polygon (Google Earth Engine Python)
4. Update farm_fields with latest NDVI health score
5. Detect anomalies: NDVI drop > 20% in 7 days → potential stress alert

Job: MODEL_RETRAIN (runs weekly)
1. Collect new labeled data: farmer_actions + outcomes since last run
2. Fine-tune recommendation model on new outcomes
3. Log new model version to MLflow
4. Run validation: if AUC > current deployed model → promote to production
5. Archive old model version
```

---

## 7. MOBILE PWA — FARMER APP

Route: `/m/*` for mobile-optimized pages, or make entire app responsive with mobile-first Tailwind.

**Key Mobile-Specific Requirements:**
- Installable PWA: manifest.json, service worker, offline mode
- Offline: cache last 72h alerts, farm data, basic map tiles
- Background sync: queue actions taken offline, sync when online
- Geolocation: auto-detect farm location
- Camera: scan crop images for disease detection (optional bonus: MobileNet classifier)
- Voice: Web Speech API for voice-to-text in AI Advisor
- Touch-optimized: large tap targets (min 48px), swipe gestures, bottom sheet modals
- Low-bandwidth mode: compress images, smaller API payloads, lazy load everything

**SMS Fallback (for feature phones):**
Build a Twilio webhook handler that parses simple SMS commands:
- `STATUS` → reply with current risk level for registered farm
- `HELP` → reply with list of commands
- `ALERT` → reply with any active alerts
- `ADVICE` → reply with top 3 recommendations

---

## 8. DESIGN SYSTEM & UI SPECIFICATIONS

### Color Palette
```css
:root {
  /* Primary - Nature-inspired green spectrum */
  --color-primary-50: #f0fdf4;
  --color-primary-100: #dcfce7;
  --color-primary-500: #22c55e;
  --color-primary-600: #16a34a;
  --color-primary-900: #14532d;

  /* Risk Colors */
  --color-risk-low: #22c55e;      /* green */
  --color-risk-medium: #f59e0b;   /* amber */
  --color-risk-high: #ef4444;     /* red */
  --color-risk-critical: #7c3aed; /* purple */

  /* Government portal accent */
  --color-gov-primary: #0f172a;   /* slate 900 */
  --color-gov-accent: #10b981;    /* emerald 500 */

  /* Supply chain accent */
  --color-sc-primary: #1e3a5f;    /* navy */
  --color-sc-accent: #f59e0b;     /* amber */

  /* Backgrounds */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8fafc;
  --color-bg-card: #ffffff;

  /* Dark mode */
  --color-dark-bg: #0a0f1e;
  --color-dark-card: #111827;
  --color-dark-border: #1f2937;
}
```

### Typography
- Headings: `Inter` (weight 700/800) — clean, modern, professional
- Body: `Inter` (weight 400/500)
- Monospace (data): `JetBrains Mono` for sensor readings, coordinates
- Use fluid typography: `clamp(1rem, 2vw, 1.25rem)` for responsive sizes

### Component Specifications

**Risk Meter Component:**
```
Circular gauge (SVG), 0-100%
Background: gray arc
Fill: color transitions green→amber→red
Center: percentage + risk label
Animated: smooth interpolation on value change
Sizes: sm (64px) / md (120px) / lg (200px)
```

**Alert Card Component:**
```
Left border: 4px solid [risk color]
Icon: [alert type icon] in colored circle
Title: bold, 16px
Description: 14px, muted
Time badge: "3h remaining" or "Ongoing"
Action buttons: max 2, ghost style
Animated: slide-in from right, pulse on critical
```

**Map Layer Control:**
```
Floating panel (top-right corner)
Layer toggle switches (animated)
Opacity sliders per layer
Legend panel (bottom-left)
Scale bar
Attribution (bottom-right)
```

**Micro-interactions (use Framer Motion for all):**
- Page transitions: fade + slight Y translateY
- Card hover: subtle scale(1.01) + shadow elevation
- Button press: scale(0.97)
- Alert arrival: slide in from top-right
- Risk meter: spring animation on value change
- Loading states: skeleton shimmer (not spinners)
- Success states: checkmark morphing animation

---

## 9. INTERNATIONALIZATION IMPLEMENTATION

**Supported Languages:**
1. English (default)
2. Hindi (हिन्दी) — India
3. Bengali (বাংলা) — Bangladesh + West Bengal
4. Vietnamese (Tiếng Việt) — Vietnam (Mekong Delta)
5. Filipino/Tagalog — Philippines
6. Bahasa Indonesia — Indonesia
7. Tamil (தமிழ்) — Sri Lanka + Tamil Nadu
8. Sinhala (සිංහල) — Sri Lanka

**Implementation:**
- `next-intl` for static UI strings: navigation, buttons, labels
- DeepL API for dynamic AI-generated content translation (alerts, recommendations)
- Language detection: browser preference → user profile setting → URL prefix (`/vi/`, `/hi/`, etc.)
- RTL support: prepared CSS for potential Arabic/Urdu expansion
- Number formatting: locale-aware (₹ for India, ₫ for Vietnam, ₱ for Philippines)
- Date formatting: locale-aware via `Intl.DateTimeFormat`

**Translation Files structure:**
```
packages/i18n/
├── en.json
├── hi.json
├── bn.json
├── vi.json
├── fil.json
├── id.json
├── ta.json
└── si.json
```

---

## 10. API DESIGN

### REST + tRPC Hybrid

**Public REST endpoints (for SMS bot, webhooks, third-party integrations):**
```
GET  /api/v1/risk?lat=&lon=&type=flood|salinity
POST /api/v1/alerts/webhook          # inbound webhook from external systems
GET  /api/v1/health                  # uptime endpoint
POST /api/v1/sms/inbound             # Twilio SMS webhook handler
```

**tRPC Routers (authenticated, type-safe):**
```typescript
// routers/farmer.ts
farmerRouter.query('getProfile', ...)
farmerRouter.query('getFields', ...)
farmerRouter.query('getCurrentRisk', ...)        // aggregated risk for all fields
farmerRouter.query('getAlerts', ...)
farmerRouter.query('getRecommendations', ...)
farmerRouter.mutation('markAlertActioned', ...)
farmerRouter.mutation('logFarmerAction', ...)
farmerRouter.subscription('riskUpdates', ...)    // WebSocket subscription

// routers/government.ts
govRouter.query('getRegionOverview', ...)
govRouter.query('getResourceInventory', ...)
govRouter.query('getAlertHistory', ...)
govRouter.mutation('createAlert', ...)
govRouter.mutation('dispatchResources', ...)
govRouter.mutation('approveResourceRequest', ...)

// routers/supplyChain.ts
scRouter.query('getNodeRisks', ...)
scRouter.query('getCommodityRisks', ...)
scRouter.query('getScenarioAnalysis', ...)
scRouter.mutation('configureWebhook', ...)

// routers/ml.ts
mlRouter.mutation('getFloodRisk', ...)           // calls FastAPI
mlRouter.mutation('getSalinityRisk', ...)
mlRouter.mutation('askAdvisor', ...)             // RAG query
mlRouter.query('getModelMetrics', ...)
```

---

## 11. AUTHENTICATION & AUTHORIZATION

### Auth Strategy
- **NextAuth.js v5** with custom credentials + OTP
- **Farmer signup flow:** Phone number → OTP via Twilio SMS → profile creation
- **Org signup flow:** Email → magic link → org details → admin verification
- **OAuth:** Google OAuth optional (for convenience)

### Role-Based Access Control (RBAC)
```typescript
enum Role {
  FARMER = 'farmer',
  FIELD_OFFICER = 'field_officer',   // gov district level
  REGIONAL_ADMIN = 'regional_admin', // gov province level
  NATIONAL_ADMIN = 'national_admin', // gov country level
  SUPPLY_CHAIN_ANALYST = 'supply_chain_analyst',
  SUPPLY_CHAIN_ADMIN = 'supply_chain_admin',
  PLATFORM_ADMIN = 'platform_admin'
}

// Permissions matrix
PERMISSIONS = {
  'view_farm_data': [FARMER, FIELD_OFFICER, REGIONAL_ADMIN, ...],
  'create_alert': [FIELD_OFFICER, REGIONAL_ADMIN, NATIONAL_ADMIN, PLATFORM_ADMIN],
  'approve_resources': [REGIONAL_ADMIN, NATIONAL_ADMIN, PLATFORM_ADMIN],
  'view_supply_chain': [SUPPLY_CHAIN_ANALYST, SUPPLY_CHAIN_ADMIN, PLATFORM_ADMIN],
  'access_admin_panel': [PLATFORM_ADMIN]
}
```

### Supabase RLS Policies
```sql
-- Farmers can only read their own data
CREATE POLICY "farmers_own_data" ON farm_fields
  USING (farmer_id = auth.uid());

-- Government officers can read data within their region
CREATE POLICY "gov_regional_access" ON farmer_profiles
  USING (
    EXISTS (
      SELECT 1 FROM government_regions gr
      JOIN user_organizations uo ON uo.org_id = gr.org_id
      WHERE uo.user_id = auth.uid()
      AND ST_Within(location, gr.geometry)
    )
  );
```

---

## 12. SUBSCRIPTION & MONETIZATION

### Pricing Tiers

**Free Tier — Farmer Basic:**
- Up to 2 farm fields (10 ha max)
- Flood alerts (24h advance)
- Basic weather forecast (7 days)
- App + SMS alerts (5/month)
- English only

**Farmer Pro — ₹199/month (or $3/month):**
- Unlimited fields
- Flood + Salinity alerts (72h advance)
- AI Advisor (50 queries/month)
- All 8 languages
- Satellite field scans (weekly)
- WhatsApp alerts
- Crop loss insurance recommendations

**Government Basic — $299/month per agency:**
- Regional dashboard (1 province)
- Alert broadcasting to registered farmers
- Resource tracking
- Monthly reports

**Government Enterprise — Custom pricing:**
- National-level dashboard
- Multi-province management
- API access
- Custom alert templates
- Dedicated support
- SLA 99.9%

**Supply Chain — $499/month:**
- Commodity risk tracking (10 commodities)
- Scenario modeling
- API + webhook access
- Integration support

### Payment Integration
- **Stripe** for card payments (global)
- **Razorpay** for India (UPI, net banking, cards)
- **PayMongo** for Philippines
- Subscription management: Stripe Billing + webhook for status sync
- Free trial: 14 days for all paid tiers (no credit card required)

---

## 13. DEPLOYMENT & INFRASTRUCTURE

### Production Deployment Checklist

**Vercel (Frontend):**
```
vercel.json configuration:
- Framework: Next.js
- Build command: turbo build --filter=web
- Output directory: apps/web/.next
- Environment variables: all secrets from Doppler
- Edge functions: risk API endpoints for low latency
- Domain: agrishield.io (+ www redirect)
- Analytics: enabled
```

**Railway (Backend Services):**
```
Services to deploy:
1. agri-shield-api (Node.js/Express tRPC backend)
2. agri-shield-ml (FastAPI Python ML server)
3. agri-shield-worker (BullMQ background jobs)
4. redis (Upstash Redis, or Railway Redis plugin)

Each service:
- Auto-deploy on push to main
- Health check endpoint configured
- Auto-restart on failure
- Resource limits: 1GB RAM minimum for ML server
- Environment: all secrets injected via Railway variables
```

**Supabase:**
```
- Project: agri-shield-production
- Database: PostgreSQL 16 with PostGIS + TimescaleDB extensions
- Auth: configured for OTP + magic link
- Storage buckets: satellite-imagery (public), farmer-docs (private)
- Realtime: enabled for climate_alerts table
- Edge Functions: for lightweight serverless tasks
```

**GitHub Actions CI/CD:**
```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  test:
    - pnpm lint
    - pnpm type-check
    - pnpm test (Vitest unit + integration tests)

  build:
    - turbo build (all apps)
    - Docker build for ml-api
    - Push image to GitHub Container Registry

  deploy:
    - Vercel: auto-deploys on push
    - Railway: deploy via railway CLI
    - Run database migrations: drizzle-kit migrate
    - Send deployment notification to Slack/Discord
```

---

## 14. TESTING REQUIREMENTS

Write tests for ALL of the following:

### Unit Tests (Vitest)
- All tRPC router handlers (mock DB)
- All ML model input validation
- All risk calculation utility functions
- All i18n translation key completeness
- All notification template generation

### Integration Tests (Vitest + Supertest)
- Farmer signup → onboarding → dashboard flow
- Government alert creation → delivery → farmer notification
- Flood risk API end-to-end (mock satellite data)
- Salinity prediction API end-to-end

### E2E Tests (Playwright)
- Farmer onboarding wizard complete flow
- Government creates and broadcasts alert
- Farmer receives and actions alert
- AI Advisor conversation flow
- Mobile PWA install and offline mode

### ML Model Tests (pytest)
- Flood predictor: known flood events → assert probability > 0.8
- Salinity predictor: known intrusion events → assert EC prediction within 10%
- RAG advisor: test question set → assert response contains expected action keywords

---

## 15. SEED DATA & DEMO ENVIRONMENT

The demo environment must be immediately impressive. Seed:

**Regions:** Bangladesh (Ganges-Brahmaputra delta), Vietnam (Mekong Delta), Philippines (Central Luzon), India (Odisha coast), Indonesia (Java north coast) — all with realistic geometry

**Farm Fields:** 50 demo farmer accounts with 2-5 fields each, spread across these regions. Realistic crop types, planting dates, soil data.

**Climate Data:** 
- Load 90 days of historical weather data for all demo regions
- Set current date's flood risk zones to varied levels (some green, some amber, some red) so dashboard looks alive
- Set 3 active flood alerts + 2 salinity alerts for demo regions

**Alerts History:** 200 historical alerts across demo regions, last 12 months

**Government Accounts:** 5 government demo accounts (Bangladesh Ministry of Agriculture, Vietnam MARD, Philippine DA, etc.) with their respective region access

**Supply Chain Nodes:** 20 warehouse/port/processor nodes across demo regions with realistic commodity flows (rice, wheat, jute, sugarcane)

**Demo Credentials (never expire, reset daily):**
- Farmer: `farmer@demo.agrishield.io` / OTP: `123456`
- Government: `gov@demo.agrishield.io` / Password: `demo2026`
- Supply Chain: `supply@demo.agrishield.io` / Password: `demo2026`

---

## 16. DOCUMENTATION

Build and deploy full documentation:

**`/docs` (Docusaurus or Mintlify):**
- Getting Started guide (farmer, government, supply chain)
- API Reference (auto-generated from tRPC + FastAPI OpenAPI)
- Integration Guide (webhook setup, API key, ERP integration)
- Methodology: how flood model works, how salinity model works
- Data Sources: all satellite + API data sources used
- FAQ + Troubleshooting
- Privacy Policy + Terms of Service (GDPR + India PDPB compliant)
- Impact Metrics + Methodology for calculating crop loss prevention

---

## 17. HACKATHON PITCH DECK INTEGRATION

Build `/pitch` page (non-auth, public) as a standalone showcase:

- Problem statement with animated data visualization (global crop loss stats)
- Solution overview: animated 3-portal demo flow
- Live demo embed: interactive map with real data
- Impact metrics: simulated outcomes from demo data
- Technology stack showcase
- Team section
- SDG alignment badges: SDG 2 (Zero Hunger), SDG 13 (Climate Action), SDG 17 (Partnerships)
- Contact / invest / partner CTA

---

## 18. SECURITY REQUIREMENTS

- All API endpoints: JWT authentication check
- Rate limiting: 100 req/min per user, 1000 req/min per org (Redis)
- Input sanitization: Zod schemas on ALL API inputs
- SQL injection: impossible via Drizzle ORM (parameterized only)
- XSS: Next.js default escaping + CSP headers
- CORS: allowlist only known domains
- Secrets: never in code, only env vars
- File uploads: type validation + size limits + Supabase Storage (not local)
- Audit log: all `create`/`update`/`delete` operations logged with user ID + timestamp
- HTTPS only: enforced via Vercel + HSTS headers
- OWASP Top 10: verify mitigations for all 10 risks

---

## 19. PERFORMANCE REQUIREMENTS

- Lighthouse score: ≥90 on all 4 metrics (Performance, Accessibility, Best Practices, SEO)
- LCP (Largest Contentful Paint): < 2.5s
- Map render: < 1s on 4G connection
- Alert delivery: < 30 seconds from trigger to farmer SMS receipt
- API response time: < 200ms for cached, < 2s for ML inference
- Database: all spatial queries < 500ms (verified with EXPLAIN ANALYZE)
- Image optimization: all images via next/image with WebP format
- Bundle size: < 300KB initial JS (use dynamic imports for map, chart libraries)

---

## 20. FINAL BUILD ORDER

Build in this exact order to avoid dependency issues:

1. **Monorepo setup** (Turborepo + pnpm workspaces)
2. **Database schema** (Drizzle ORM + Supabase setup + all migrations)
3. **Auth system** (NextAuth.js + Supabase Auth + roles)
4. **Design system** (`packages/ui` — all components, color system, typography)
5. **Landing page** (Next.js `app/page.tsx` — full cinematic page)
6. **Farmer onboarding** (wizard + field drawing)
7. **ML API** (FastAPI flood predictor + salinity predictor + RAG advisor)
8. **Background jobs** (BullMQ workers: climate scan + notification dispatch)
9. **Farmer dashboard** (all 5 tabs + real-time alerts)
10. **Government dashboard** (map + resource management + analytics)
11. **Supply chain dashboard** (risk tracker + scenarios)
12. **Real-time layer** (Socket.io + alert delivery pipeline)
13. **SMS/WhatsApp integration** (Twilio)
14. **Multilingual support** (next-intl + DeepL for dynamic content)
15. **PWA + offline mode** (service worker + manifest)
16. **Subscription + payment** (Stripe + Razorpay)
17. **Admin panel**
18. **Tests** (unit + integration + E2E)
19. **Seed data** (full demo environment)
20. **Documentation** (Mintlify docs site)
21. **Deployment** (Vercel + Railway + Supabase production)
22. **Performance audit** (Lighthouse + fix all issues)
23. **Security audit** (OWASP checklist)
24. **Pitch page** (`/pitch` for hackathon showcase)

---

## 21. WHAT MAKES AGRI-SHIELD UNIQUE (Build These Differentiators Explicitly)

1. **72-hour lead time** (vs. industry standard 24h) through ensemble ML combining LSTM + satellite + IoT
2. **Three-portal architecture** on a single unified data platform — no competitor serves all three stakeholders
3. **Salinity intrusion prediction** — virtually no competitor does this proactively
4. **RAG-powered multilingual advisor** that knows YOUR farm's exact conditions
5. **Supply chain financial impact modeling** — bridges agri risk and trade finance
6. **SMS fallback for feature phones** — serves farmers without smartphones
7. **Outcome feedback loop** — farmer actions logged → model improves → better predictions
8. **Government resource coordination** built INTO the same platform, not a separate system
9. **Offline-first PWA** — works in low-connectivity rice paddies
10. **Open data integration** — NASA, Copernicus, Google Flood, FAO — no proprietary satellite hardware needed

---

## 22. ENVIRONMENT VARIABLES TEMPLATE

```env
# App
NEXT_PUBLIC_APP_URL=https://agrishield.io
NEXT_PUBLIC_APP_NAME=Agri-SHIELD

# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# Maps
NEXT_PUBLIC_MAPBOX_TOKEN=

# ML API
ML_API_URL=https://ml.agrishield.io
ML_API_KEY=

# External APIs
OPENWEATHERMAP_API_KEY=
GOOGLE_FLOOD_API_KEY=
AMBEE_API_KEY=
EARTHENGINE_SERVICE_ACCOUNT=

# Notifications
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_WHATSAPP_NUMBER=

# Email
RESEND_API_KEY=

# Translation
DEEPL_API_KEY=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

# LLM
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Monitoring
SENTRY_DSN=
POSTHOG_KEY=

# Redis
REDIS_URL=

# Feature Flags
NEXT_PUBLIC_ENABLE_VOICE_INPUT=true
NEXT_PUBLIC_ENABLE_CAMERA_DISEASE=false
NEXT_PUBLIC_DEMO_MODE=false
```

---

*Build Agri-SHIELD to production standard. Every screen must work. Every API must return real data. Every model must produce real predictions. This is not a prototype — it is a product. Make it beautiful, make it powerful, make it ready to sell.*

---

**Last updated:** July 2026 | **Version:** 1.0.0-production | **Target:** Asian Hackathon for Green Future 2026 — Water Resources & Climate-Resilient Agriculture Track

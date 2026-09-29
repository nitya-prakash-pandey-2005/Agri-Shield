/**
 * Help-centre content (pure data): articles, FAQs and changelog. Shared by
 * /help, /help/[slug], /changelog and the in-app search.
 */

export type HelpBlock = { h?: string; p?: string; list?: string[]; steps?: string[]; tip?: string; link?: { href: string; label: string } };

export interface HelpArticle {
  slug: string;
  title: string;
  category: "Getting started" | "Understanding risk" | "Using the workspace" | "Account & billing" | "Developers";
  audience?: "insurance" | "banking" | "ngo" | "cooperative" | "agribusiness" | "government";
  summary: string;
  minutes: number;
  body: HelpBlock[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  // ─── Getting started per industry ────────────────────────────────────
  {
    slug: "start-insurance",
    title: "Getting started for insurers",
    category: "Getting started",
    audience: "insurance",
    summary: "Load your book of policies, watch parametric triggers and price new locations in your first hour.",
    minutes: 4,
    body: [
      { p: "Agri-SHIELD helps crop and parametric insurers see — before the event — which policies are likely to claim, and price new business with forecasts, satellite data and 40+ years of climate history." },
      { h: "Your first hour", steps: ["Import policies in Portfolio (CSV with name, latitude, longitude, sum insured, crop, product). Each row becomes an insured unit (a single policy or a group policy covering many farmers).", "Open Home: the briefing tells you how many insured units face high flood risk in the next 72 hours and where.", "In Insurance, check which parametric policies are close to their payout trigger and estimate payouts.", "Create an alert rule, e.g. 72-hour rain ≥ 120 mm on plots tagged ‘parametric’, emailed to claims.", "Generate a Board pack or Portfolio risk summary in Reports for your management meeting."] },
      { tip: "Tag plots with the product type (parametric, indemnity) — rules and reports can then target each book separately." },
      { h: "Key terms", list: ["Basis risk — when an index policy's payout doesn't match the farmer's actual loss.", "Burning cost — what the policy would have paid on average in past years.", "PML — the loss you'd expect from a rare (e.g. 1-in-100-year) event."] },
      { link: { href: "/help/glossary", label: "Open the full glossary" } },
    ],
  },
  {
    slug: "start-banking",
    title: "Getting started for banks & MFIs",
    category: "Getting started",
    audience: "banking",
    summary: "See which agricultural loans are exposed to floods, salinity and drought, and how that changes default risk.",
    minutes: 4,
    body: [
      { p: "Agricultural lenders use Agri-SHIELD to spot climate stress in the loan book early, adjust provisioning and do climate due diligence on new borrowers." },
      { h: "Your first hour", steps: ["Import loans in Portfolio with the borrower's farm location and outstanding balance (EAD).", "Home shows loans above your risk threshold and the exposure they carry.", "Lending & Finance stress-tests the book: how a flood or salinity shock raises PD and expected credit loss.", "Run a Location due-diligence report on any new borrower's coordinates before approval.", "Generate the Physical-risk disclosure (TCFD / ISSB S2 structure) for regulators and investors."] },
      { tip: "Set the at-risk threshold in Settings → General to match your credit policy (e.g. 55 for a cautious book)." },
    ],
  },
  {
    slug: "start-ngo",
    title: "Getting started for NGOs (anticipatory action)",
    category: "Getting started",
    audience: "ngo",
    summary: "Monitor communities, set pre-agreed triggers and release support before the flood arrives.",
    minutes: 4,
    body: [
      { p: "Anticipatory action means acting on a forecast — sending cash or evacuation support a few days before a disaster, when it does the most good." },
      { h: "Your first hour", steps: ["Add the communities you serve in Portfolio, with households and the cash envelope per household.", "Home tells you how many households are in high-risk areas in the next 72 hours.", "In Anticipatory Action, define triggers (e.g. flood probability ≥ 60% with 72 h lead time) and the actions they unlock.", "Schedule the Weekly digest for your donors and country office."] },
      { tip: "Lead time is everything: a 72-hour warning lets families move livestock and store seed." },
    ],
  },
  {
    slug: "start-cooperative",
    title: "Getting started for farmer co-operatives",
    category: "Getting started",
    audience: "cooperative",
    summary: "Keep every member farm in view and warn members early by SMS or WhatsApp.",
    minutes: 3,
    body: [
      { p: "Co-operatives use Agri-SHIELD to protect their members' harvests and plan collective action — shared pumps, early harvest, salt-tolerant seed." },
      { h: "Your first hour", steps: ["Add member farms in Portfolio (location, crop, area).", "Check Home for farms at risk this week and the hectares involved.", "Create an alert rule that SMSes members when flood probability or salinity crosses a threshold.", "Use Copilot to ask practical agronomy questions in plain language."] },
    ],
  },
  {
    slug: "start-agribusiness",
    title: "Getting started for agribusiness & food companies",
    category: "Getting started",
    audience: "agribusiness",
    summary: "Map warehouses, plants and sourcing regions and get warned before disruption hits supply.",
    minutes: 3,
    body: [
      { p: "Traders, processors and food companies use Agri-SHIELD to see climate disruption across facilities and sourcing regions before it reaches the P&L." },
      { h: "Your first hour", steps: ["Add facilities and key sourcing locations in Portfolio with their value or capacity.", "Home shows capacity at risk and live disasters near your sites.", "Create webhooks (Settings → API) so your ERP gets threshold alerts automatically.", "Use Risk Explorer to vet a new supplier's location."] },
    ],
  },
  {
    slug: "start-government",
    title: "Getting started for governments",
    category: "Getting started",
    audience: "government",
    summary: "National early warning, anticipatory action and resource dispatch in one command centre.",
    minutes: 3,
    body: [
      { p: "Ministries and disaster agencies use the command centre for district-level early warning, broadcasts to registered farmers and resource dispatch, and the workspace for analysis and reporting." },
      { h: "Your first hour", steps: ["Open the command centre (Quick actions on Home) to see districts ranked by flood and salinity risk.", "Use Risk Explorer on any district or coordinate for a full hazard report.", "Schedule the Weekly digest as a minister's brief."] },
      { link: { href: "/docs/governments", label: "Government guide in the docs" } },
    ],
  },

  // ─── Understanding risk ──────────────────────────────────────────────
  {
    slug: "how-scores-work",
    title: "How risk scores work",
    category: "Understanding risk",
    summary: "What the 0–100 scores mean, where they come from and how often they update.",
    minutes: 5,
    body: [
      { p: "Every location gets four hazard scores — flood, salinity, drought and heat — and one composite score. All run from 0 (no concern) to 100 (extreme)." },
      { h: "The bands", list: ["0–34 Low: normal conditions.", "35–59 Medium: keep an eye on it.", "60–79 High: plan action now.", "80–100 Critical: act immediately."] },
      { h: "What goes in", list: ["Flood: forecast rain over 24/48/72 hours, soil wetness, river discharge vs normal (GloFAS), elevation and past floods.", "Salinity: coastal exposure, season, recent rain, sea-level anomaly and river flow; reported as EC in dS/m.", "Drought: rain deficit (SPI) and the 7-day water balance (rain minus evaporation).", "Heat: forecast maximum temperatures and the number of damaging hot days."] },
      { h: "The composite", p: "The biggest hazard dominates and the others add on top, so a place with one extreme hazard still shows as high risk. Your workspace's at-risk threshold (default 60) decides what counts as 'at risk' on dashboards." },
      { h: "Freshness", p: "Assets are re-scored at least every 6 hours from live forecasts. Every number on screen carries a source tag showing where it came from and when." },
      { tip: "Scores are probabilities and indices, not guarantees. Use them to prioritise, then confirm on the ground where it matters." },
      { link: { href: "/docs/methodology-flood", label: "Full flood model methodology" } },
    ],
  },
  {
    slug: "data-sources",
    title: "Where the data comes from",
    category: "Understanding risk",
    summary: "The open, authoritative sources behind every number — and what happens if one is down.",
    minutes: 3,
    body: [
      { list: ["Weather forecasts — Open-Meteo (blend of ECMWF, GFS, ICON).", "River flow — Copernicus GloFAS v4.", "Climate history — ECMWF ERA5 reanalysis since 1940.", "Disasters — UN/EC GDACS and NASA EONET.", "Satellite — NASA GIBS (MODIS, VIIRS, HLS), ORNL MODIS NDVI, JRC Global Surface Water.", "Terrain — Copernicus DEM.", "Soil — ISRIC SoilGrids."] },
      { p: "If a source is unreachable we fall back to the last good value and label it as a fallback. The public status page shows the health of every source." },
      { link: { href: "/status", label: "Open the status page" } },
    ],
  },

  // ─── Using the workspace ─────────────────────────────────────────────
  {
    slug: "alert-rules",
    title: "Alert rules: get told automatically",
    category: "Using the workspace",
    summary: "Create 'if this, then notify' rules on flood, salinity, rain, drought and heat.",
    minutes: 3,
    body: [
      { steps: ["Go to Alerts & Rules → New rule.", "Choose which assets it watches (all, by tag, by type or country).", "Add conditions, e.g. flood probability (72 h) > 60.", "Pick channels (in-app, email, SMS, WhatsApp, webhook, Slack) and recipients.", "Set a cooldown so you're not re-alerted every hour while the condition stays true."] },
      { tip: "Start with one rule per team. You can test a rule against today's data before switching it on." },
    ],
  },
  {
    slug: "reports",
    title: "Reports: generate, schedule, share",
    category: "Using the workspace",
    summary: "Board packs, disclosures and due-diligence PDFs from live data.",
    minutes: 2,
    body: [
      { list: ["Portfolio risk summary — all assets scored, top risks and clusters.", "Location due-diligence — full hazard report for one site.", "Physical-risk disclosure — TCFD / ISSB S2 structure.", "Weekly digest — what changed in 7 days.", "Board pack — one-glance executive summary."] },
      { p: "Generate now to download a PDF instantly, or schedule weekly/monthly and we'll email recipients a link. Every report stays in the history so you can download it again — the content is frozen at the time it was generated." },
    ],
  },
  {
    slug: "team-and-roles",
    title: "Inviting your team & roles",
    category: "Using the workspace",
    summary: "Admins and analysts, invite links, seats and removing people.",
    minutes: 2,
    body: [
      { steps: ["Settings → Team → Invite a teammate.", "Enter their work email and pick a role.", "They receive an email; you also get a link you can share directly. It's valid for 7 days and works once.", "Change roles or remove people any time. Role changes apply at their next sign-in."] },
      { list: ["Admin — everything, including team, billing, API keys and deletion.", "Analyst — portfolio, alerts, reports; no billing or team changes."] },
    ],
  },

  // ─── Account & billing ───────────────────────────────────────────────
  {
    slug: "plans-and-usage",
    title: "Plans, trials and usage limits",
    category: "Account & billing",
    summary: "What each plan includes, how usage is counted, and what happens when a trial ends.",
    minutes: 3,
    body: [
      { list: ["Free — 25 assets, 250 assessments/month, 2 seats, 5 reports/month.", "Business ($1,490/month) — 2,500 assets, 10 seats, 25,000 assessments/month, API, scheduled reports.", "Enterprise (from $4,900/month, annual) — unlimited assets and seats, multiple workspaces, 99.9% SLA, dedicated support."] },
      { p: "New organisation workspaces start with a 14-day Business trial, no card needed. When it ends without a plan, the workspace moves to Free limits — nothing is deleted." },
      { p: "Usage resets on the 1st of each month (UTC). You'll get a notification at 80% and 100% of any limit. See live meters in Settings → Plan & billing." },
    ],
  },
  {
    slug: "security-privacy",
    title: "Security, privacy and your data",
    category: "Account & billing",
    summary: "How we protect data, export everything, and delete a workspace.",
    minutes: 2,
    body: [
      { list: ["Role-based access on every screen and API call.", "API keys shown once and stored only as SHA-256 hashes.", "Webhooks signed with HMAC-SHA256.", "Every change recorded in the workspace audit log.", "Export the whole workspace as JSON in Settings → Security.", "Workspace deletion has a 30-day grace period any admin can cancel."] },
      { link: { href: "/trust", label: "Read the Trust centre" } },
    ],
  },

  // ─── Developers ──────────────────────────────────────────────────────
  {
    slug: "api-and-webhooks",
    title: "API keys & webhooks",
    category: "Developers",
    summary: "Pull risk into your systems and get events pushed to you.",
    minutes: 3,
    body: [
      { steps: ["Settings → API & integrations → New key. Choose scopes (e.g. risk:read). Copy it — it's shown once.", "Call the REST API with the header X-API-Key.", "Add a webhook endpoint to receive events like report.ready or rule.triggered.", "Verify the X-AgriShield-Signature header (HMAC-SHA256 of the raw body with your signing secret)."] },
      { link: { href: "/docs/api-reference", label: "REST API reference" } },
    ],
  },
];

export const FAQS: { q: string; a: string; category: string }[] = [
  { category: "General", q: "Which countries do you cover?", a: "Any location on Earth for forecasts, river flow, climate history and satellite data. Our deepest calibration (district models, salinity) is in the Ganges–Brahmaputra, Mekong, Mahanadi, Pampanga and Java deltas." },
  { category: "General", q: "How accurate are the flood forecasts?", a: "Accuracy depends on lead time and place. We document the validation approach and metrics (AUC, Brier score) in the methodology docs and label every score with its source. Treat scores as probabilities to prioritise action, not guarantees." },
  { category: "General", q: "How often is data updated?", a: "Forecast-driven scores refresh at least every 6 hours; disaster feeds every 30 minutes; satellite NDVI every 8–16 days as NASA publishes new composites." },
  { category: "Workspace", q: "Can I upload my existing portfolio?", a: "Yes — Portfolio accepts CSV with latitude/longitude (or addresses), a value column and optional crop, tags and your own reference IDs." },
  { category: "Workspace", q: "What does 'at risk' mean on Home?", a: "An asset whose composite score is at or above your workspace threshold (default 60/100). Admins can change the threshold in Settings → General and see instantly how many assets it affects." },
  { category: "Workspace", q: "Can I restart the product tour?", a: "Yes — use the ? menu in the top bar or the button on this page." },
  { category: "Billing", q: "Do I need a card for the trial?", a: "No. The 14-day Business trial needs no card. If you don't choose a plan, the workspace moves to the Free plan." },
  { category: "Billing", q: "What counts as an assessment?", a: "One full location risk report — for example a Risk Explorer lookup or a location due-diligence report. Automatic re-scoring of your saved portfolio doesn't count." },
  { category: "Security", q: "Where is my data stored?", a: "See the Trust centre for current hosting and data-residency options. You can export everything as JSON at any time." },
  { category: "Security", q: "Do you train models on my data?", a: "No. Your portfolio and uploads are used only to serve your workspace. Models are trained on public climate and hazard data." },
];

export const CHANGELOG: { date: string; version: string; title: string; tag: "new" | "improved" | "fixed"; items: string[] }[] = [
  {
    date: "2026-09-29",
    version: "2.0",
    title: "Agri-SHIELD Workspaces",
    tag: "new",
    items: [
      "Multi-tenant workspaces for insurers, banks, NGOs, co-operatives, agribusiness and governments, with industry-aware Home dashboards.",
      "Daily plain-language risk briefing computed from your live portfolio.",
      "Self-serve organisation sign-up with a 14-day Business trial, onboarding checklist and interactive product tour.",
      "Team management with invite links, roles and seat limits.",
      "Reports hub: portfolio summary, location due-diligence, physical-risk disclosure (TCFD/ISSB S2), weekly digest and board pack — as PDF, on demand or scheduled.",
      "Workspace API keys (SHA-256 hashed), signed webhooks, usage meters and plan limits.",
      "Help centre with a 70+ term glossary, public status page and Trust centre.",
    ],
  },
  {
    date: "2026-09-15",
    version: "1.6",
    title: "Location engine for any coordinate",
    tag: "new",
    items: ["Batched risk scoring for portfolios of hundreds of assets in a few requests.", "Full hazard reports for any point on Earth: flood, salinity, drought and heat with drivers.", "Live disaster feeds (GDACS, NASA EONET) matched to nearby assets."],
  },
  {
    date: "2026-08-28",
    version: "1.5",
    title: "Supply-chain API & webhooks",
    tag: "improved",
    items: ["Commodity risk REST endpoint with scoped API keys.", "HMAC-signed webhook deliveries with a delivery log and test sends.", "Monte Carlo disruption scenarios with side-by-side comparison."],
  },
  {
    date: "2026-08-05",
    version: "1.4",
    title: "Government command centre",
    tag: "improved",
    items: ["District risk ranking from live Open-Meteo and GloFAS data.", "Broadcast alerts to registered farmers in 8 languages.", "Resource requests, approvals and dispatch tracking."],
  },
  {
    date: "2026-07-18",
    version: "1.3",
    title: "Farmer app: offline & SMS",
    tag: "improved",
    items: ["Installable offline app with cached alerts.", "SMS commands for farmers without data.", "NASA MODIS NDVI field health."],
  },
  {
    date: "2026-07-02",
    version: "1.2",
    title: "Reliability fixes",
    tag: "fixed",
    items: ["Graceful fallbacks when a data provider is slow or down.", "Faster map rendering on low-end phones."],
  },
];

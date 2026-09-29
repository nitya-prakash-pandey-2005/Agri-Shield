export const GETTING_STARTED = `Agri-SHIELD turns open climate data into role-specific decisions for three groups: farmers, government agencies and supply-chain teams. All three portals read the same live risk engine, so an alert a farmer sees is the same event a district officer is dispatching pumps for.

## Try it in two minutes

1. Open the [live demo map](/#demo). No account is needed. Switch between **Flood** and **Salinity** and click any district for rainfall, river discharge and soil EC.
2. Press **⌘K** (or **Ctrl K**) anywhere and choose a demo role, or sign in manually:

| Role | Sign-in | Credentials |
| --- | --- | --- |
| Farmer | Phone or email + OTP | \`farmer@demo.agrishield.io\`, OTP \`123456\` |
| Government (national admin) | Email + password | \`gov@demo.agrishield.io\` / \`demo2026\` |
| Supply chain admin | Email + password | \`supply@demo.agrishield.io\` / \`demo2026\` |
| Platform admin | Email + password | \`admin@demo.agrishield.io\` / \`demo2026\` |

> [!NOTE]
> Demo mode (the default, \`NEXT_PUBLIC_DEMO_MODE\` not set to \`false\`) accepts OTP \`123456\` for demo identities. In production OTPs are random six-digit codes delivered by SMS through Twilio, valid for 10 minutes with at most 5 attempts.

## What is live and what is seeded

| Data | Source | Refresh |
| --- | --- | --- |
| District rainfall, soil moisture, temperature | Open-Meteo forecast API | every 20 min |
| River discharge vs 30-day mean | Copernicus GloFAS via Open-Meteo Flood API | every 20 min (API cache 60 min) |
| Sea-level height for tidal amplification | Open-Meteo Marine API | every 20 min (API cache 60 min) |
| Disaster events | GDACS + NASA EONET | 30 min cache |
| Satellite layers | NASA GIBS (MODIS true colour, NDVI, IMERG) | daily tiles |
| Farmers, fields, alerts, resources, commodities | Seeded demo store (5 deltas, 22 districts) | writable, reset on demand |

Everything on screen carries a source tag. If an upstream API is unreachable, the platform keeps the last good values and the tag switches to *Seeded baseline* instead of pretending to be live.

## Next steps

- Farmers: read [Getting started for farmers](/docs/farmers).
- Agencies: read [Getting started for governments](/docs/governments).
- Buyers and lenders: read [Getting started for supply chains](/docs/supply-chain).
- Developers: jump to the [API reference](/docs/api-reference) and [Integration guide](/docs/integration-guide).
`;

export const FARMERS = `The farmer portal is a mobile-first, installable app. It works offline and falls back to SMS for feature phones.

## 1. Create your account

1. Go to [Sign up](/auth/signup?role=farmer) and choose **Farmer**.
2. Enter your phone number. You will receive a six-digit code by SMS.
3. Pick your language. Agri-SHIELD supports English, हिन्दी, বাংলা, Tiếng Việt, Filipino, Bahasa Indonesia, தமிழ் and සිංහල; interface translations ship progressively per locale.

## 2. Add your fields

The onboarding wizard asks for your location (GPS or search), then lets you draw each field on the map. For each field give the crop, planting date, irrigation and soil type. The free plan covers **2 fields up to 10 ha**; Farmer Pro removes the limit.

## 3. Read your risk

- **Flood probability for 24, 48 and 72 hours**, from rainfall forecasts, soil saturation, river discharge and your field's elevation.
- **Soil salinity (EC, dS/m)** now and in 7 and 30 days, compared with your crop's tolerance.
- **Three concrete actions** per alert, for example "open bunds toward the canal", "move seed stock to high ground" or "irrigate before the salt front arrives".

## 4. Act and log it

Mark an alert as actioned or log what you did. Your actions help your district office see where help is needed and are used to recalibrate thresholds for your area. If you are offline, the action is saved on the phone and sent automatically when you reconnect.

## 5. Install the app

On Android, Chrome shows **Install Agri-SHIELD** after a short visit; on iPhone use **Share → Add to Home Screen**. The installed app keeps the last 72 hours of alerts and map tiles available offline and can show alerts as notifications.

## SMS commands (feature phones)

Send one of these words to the Agri-SHIELD number:

| Command | Reply |
| --- | --- |
| \`STATUS\` | Current flood and salinity risk for your registered farm |
| \`ALERT\` | Any active alerts |
| \`ADVICE\` | Top three recommendations |
| \`HELP\` | The list of commands |

> [!TIP]
> Replies are kept to two SMS segments so they arrive in full on basic phones.
`;

export const GOVERNMENTS = `The government portal is a regional or national command centre: see which districts are at risk, pre-position resources, and broadcast alerts to registered farmers.

## Access and roles

Organisations sign up as **Government Officer**; the organisation is created on the *Government Basic* plan and a platform admin can verify it from the admin panel. Roles:

| Role | Can |
| --- | --- |
| Field officer | View dashboards, request resources, create alerts |
| Regional admin | Everything above, plus approve resource requests |
| National admin | Everything above, across all provinces |

## Daily workflow

1. **Overview**: districts ranked by combined flood and salinity risk, with 72-hour flood probability and live rainfall.
2. **Map**: district polygons over dark, satellite, MODIS or NDVI basemaps, with NASA IMERG rain overlay and live GDACS/EONET events.
3. **Resources**: inventory of pumps, sandbags, boats and relief kits by depot; request, approve, dispatch and mark delivered.
4. **Alerts**: compose from templates, preview reach by district, choose channels (SMS, WhatsApp, app, email) and send or schedule. Delivery receipts show sent, delivered, read and actioned counts.
5. **Analytics and policy briefs**: rainfall anomaly against the ERA5 baseline, infrastructure gaps, and exportable reports.

## Plans

Government Basic covers one province for $299/month; Enterprise adds national scope, API access, custom templates and an SLA. See [Pricing](/pricing).
`;

export const SUPPLY_CHAIN = `The supply-chain portal links district climate risk to the commodities you buy, process, insure or finance.

## Set up

1. Sign up as **Supply Chain Manager**. The organisation is created on the *Supply Chain* plan with a 14-day trial.
2. Review your **network**: sourcing regions, mills, warehouses and ports. Each node inherits risk from its district (ports get a small coastal surge premium).

## What you get

- **Commodity risk**: disruption probability, volume at risk and price-impact estimates for up to 10 commodities.
- **Scenarios**: run what-if events (monsoon surge, cyclone landfall, dry-season salinity) and see affected nodes and volumes.
- **Alternative suppliers**: nodes in lower-risk districts that can cover lost volume.
- **Webhooks and API keys**: push threshold crossings into your ERP or procurement system. See the [Integration guide](/docs/integration-guide).

## Reading the numbers

Node risk is \`0.65 × flood risk + 0.35 × salinity risk\` for the node's district, on a 0-100 scale. A score above your webhook threshold triggers a signed event. Price impact is a scenario estimate, not a market forecast; use it to size hedges, not to trade.
`;

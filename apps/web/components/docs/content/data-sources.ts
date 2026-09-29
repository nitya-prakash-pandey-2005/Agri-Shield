export const DATA_SOURCES = `Agri-SHIELD uses only free and open data. No API keys are required for any source below. This page lists every source, what it feeds, and the licence and attribution it requires.

## Weather, rivers and oceans

| Source | Endpoint | Feeds | Licence / attribution |
| --- | --- | --- | --- |
| **Open-Meteo Forecast** | \`api.open-meteo.com/v1/forecast\` | Hourly rain, rain probability, temperature, humidity, wind, soil moisture 0-7 cm; daily totals and FAO-56 ET₀ | CC BY 4.0, "Weather data by Open-Meteo.com" |
| **Copernicus GloFAS** (via Open-Meteo Flood API) | \`flood-api.open-meteo.com/v1/flood\` | Daily river discharge, 30-day history and 7-day forecast | Copernicus Emergency Management Service; Open-Meteo CC BY 4.0 |
| **Open-Meteo Marine** | \`marine-api.open-meteo.com/v1/marine\` | Sea-level height and wave height for tidal amplification | CC BY 4.0 (underlying Copernicus Marine / ECMWF data) |
| **ECMWF ERA5** (via Open-Meteo Archive) | \`archive-api.open-meteo.com/v1/archive\` | 90-day rainfall baseline for anomalies | Copernicus Climate Change Service licence; Open-Meteo CC BY 4.0 |
| **Open-Meteo Elevation** | \`api.open-meteo.com/v1/elevation\` | Field and district elevation (Copernicus DEM GLO-90) | CC BY 4.0; © DLR e.V. / Airbus, provided under Copernicus |
| **Open-Meteo Geocoding** | \`geocoding-api.open-meteo.com/v1/search\` | Place search in onboarding and the map | CC BY 4.0 (GeoNames data, CC BY 4.0) |

Requests are batched (all 22 districts in one call per API), cached in memory (20 min forecast, 60 min flood and marine, 12 h archive, 24 h elevation and geocoding) and served stale if an upstream call fails.

## Satellites and hazard feeds

| Source | Feeds | Licence / attribution |
| --- | --- | --- |
| **NASA GIBS**: MODIS Terra corrected reflectance | True-colour basemap (daily) | NASA open data; "Imagery courtesy NASA EOSDIS GIBS" |
| **NASA GIBS**: MODIS Terra NDVI 8-day | Vegetation health basemap | NASA open data |
| **NASA GIBS**: GPM IMERG precipitation rate | Rain overlay on every map | NASA open data |
| **NASA GIBS**: OSM Land/Water map | Land mask used to draw the landing-page globe | NASA GIBS; OpenStreetMap contributors (ODbL) |
| **ORNL DAAC MODIS subsets** | Field-level NDVI time series for satellite scans | NASA / ORNL DAAC, open |
| **NASA EONET v3** | Floods and severe storms (last 60 days) | NASA open data |
| **GDACS** (UN OCHA · European Commission JRC) | Flood, tropical cyclone and drought alerts (last 45 days) | Free use with attribution to GDACS |

Hazard events are filtered to the Asia-Pacific window (60°E-150°E, 15°S-40°N) and cached for 30 minutes.

## Soil and socio-economic data

| Source | Feeds | Licence |
| --- | --- | --- |
| **ISRIC SoilGrids 2.0** | Clay, silt, sand, organic carbon, pH, bulk density (0-5 cm) | CC BY 4.0, "SoilGrids, ISRIC World Soil Information" |
| **World Bank Open Data** | Country agricultural context for government and supply-chain briefs | CC BY 4.0 |
| **FAO** Irrigation & Drainage Paper 29 | Crop salinity tolerance thresholds | Cited reference values |

## Maps and translation

| Source | Use | Licence |
| --- | --- | --- |
| **OpenStreetMap** | Underlying map data | ODbL, "© OpenStreetMap contributors" |
| **Esri** World Dark Gray Canvas (base + reference labels) | Default dark basemap on every map | Esri terms of use, "Tiles © Esri, HERE, Garmin, © OpenStreetMap contributors" |
| **Esri** World Imagery | Satellite basemap | Esri terms of use, "Imagery © Esri, Maxar, Earthstar Geographics" |
| **MyMemory** translation API | Machine translation of dynamic alert text when DeepL is not configured | Free tier with fair-use limits |
| **DeepL API** (optional) | Higher-quality translation when \`DEEPL_API_KEY\` is set | Commercial API |

## Offline and failure behaviour

Set \`AGRI_OFFLINE=true\` to disable all outbound calls (for air-gapped demos); the platform then runs entirely on its seeded baseline and says so in every source tag.
`;

export const SECURITY = `A summary of how Agri-SHIELD protects accounts and data. Report vulnerabilities to **security@agrishield.io**; we acknowledge within two business days.

## Authentication and access

- **NextAuth v5** with JWT sessions (7-day expiry). Organisations sign in with email and password; farmers with a one-time code by SMS (10-minute validity, 5 attempts).
- **Role-based access control** (\`lib/rbac.ts\`) enforced in three places: route middleware, every tRPC procedure (\`permitted(...)\`), and the UI.
- Roles: farmer, field officer, regional admin, national admin, supply-chain analyst, supply-chain admin, platform admin.

## API protection

- **Zod validation** on every tRPC input and REST body.
- **Rate limits**: 100 requests/minute per user or IP and 1,000/minute per organisation.
- **Signed webhooks**: inbound alerts and outbound supply-chain events are HMAC-SHA256 signed; Stripe and Razorpay webhooks are verified with constant-time comparison and a 5-minute replay window for Stripe.
- **Twilio** inbound SMS is verified with \`X-Twilio-Signature\` when \`TWILIO_AUTH_TOKEN\` is set.

## Browser security

Every response carries \`Content-Security-Policy\`, \`X-Frame-Options: DENY\`, \`X-Content-Type-Options: nosniff\`, \`Referrer-Policy: strict-origin-when-cross-origin\` and a restrictive \`Permissions-Policy\`. React escapes all rendered content.

## Payments

Card numbers are never sent to Agri-SHIELD servers. Live checkout uses Stripe Checkout and Razorpay hosted payment links; the sandbox checkout validates cards in the browser and sends only the last four digits.

## Auditability

Sign-ins, alert broadcasts, resource approvals, billing events and admin changes are written to an append-only audit log (user, action, entity, timestamp), visible to platform admins.

## ISO 27001 readiness

The controls above map to ISO/IEC 27001:2022 Annex A themes (access control, cryptography, logging and monitoring, supplier relationships). Agri-SHIELD is **not certified**; "ISO 27001-ready" means the controls are designed in and documented for a future audit.

## Current limitations

The demo stores data in memory and uses plain-text demo passwords. Production deployments must set \`DATABASE_URL\` (PostgreSQL with row-level security), a strong \`AUTH_SECRET\`, and real OTP delivery.
`;

export const PRIVACY = `*Last updated 29 September 2026.* This policy explains what Agri-SHIELD collects, why, and your rights. It is written to meet the EU GDPR and India's Digital Personal Data Protection Act, 2023 (DPDP Act), and to respect data-protection laws in Bangladesh, Vietnam (Decree 13/2023), the Philippines (Data Privacy Act 2012) and Indonesia (PDP Law 2022).

## Who we are

Agri-SHIELD is operated by its founder, Nitya Prakash Pandey ("we"). Contact: **privacy@agrishield.io**. For government deployments, the agency is the data controller (or *Data Fiduciary* under the DPDP Act) and we act as processor.

## What we collect

| Data | Why | Legal basis |
| --- | --- | --- |
| Phone number or email, name, language | Account, sign-in codes, alerts in your language | Contract / consent |
| Farm location and field boundaries, crops, planting dates | Field-level flood and salinity risk | Contract |
| Actions you log after alerts, outcomes | Show your district office where help is needed; improve thresholds | Consent (withdrawable) |
| Organisation, role (agencies and companies) | Access control and billing | Contract |
| Payment status (never full card numbers) | Subscriptions | Contract / legal obligation |
| Device and usage logs | Security, rate limiting, reliability | Legitimate interest |

We do **not** sell personal data, use it for advertising, or share individual farm data with buyers or lenders. Supply-chain customers only see district-level aggregates.

## Sharing

- **Your government agency**, if you registered through one, sees your farm location and alert actions to coordinate help.
- **Processors**: SMS and WhatsApp (Twilio), email (Resend), payments (Stripe, Razorpay), hosting. Each is bound by a data-processing agreement.
- **Translation**: alert text (never your personal details) may be sent to MyMemory or DeepL for translation.

## Retention

Account data is kept while your account is active and deleted within 30 days of a deletion request. Alert delivery logs are kept for 24 months for public-safety audit, then aggregated. Offline data on your phone is cleared when you sign out.

## Your rights

Under GDPR and the DPDP Act you can **access**, **correct**, **erase** and **port** your data, **withdraw consent** at any time, and **nominate** someone to exercise your rights (DPDP s.14). Farmers can export their data from the profile screen. Email **privacy@agrishield.io**; we respond within 30 days. You may complain to your data-protection authority, or in India to the Data Protection Board of India.

## Children

The service is not directed at people under 18. Under the DPDP Act, we do not knowingly process children's data without verifiable parental consent.

## International transfers

Data may be processed outside your country by our processors. Transfers use standard contractual clauses (GDPR) and comply with any country restrictions notified under DPDP s.16. Government deployments can be hosted in-country.

## Security

See [Security overview](/docs/security).
`;

export const TERMS = `*Last updated 29 September 2026.* These terms govern your use of Agri-SHIELD. By creating an account you agree to them.

## The service

Agri-SHIELD provides climate risk information, alerts and planning tools for agriculture. Forecasts are **probabilistic decision support**. Weather and hydrology are uncertain: an alert may not be issued before an event, and an event may not follow an alert.

> [!WARNING]
> Agri-SHIELD does not replace official warnings from national meteorological or disaster-management authorities. Always follow official evacuation orders.

## Accounts

Keep your credentials secret and tell us about unauthorised use. Organisation admins are responsible for the users they invite.

## Plans, trials and payment

- Farmer Basic is free. Paid plans start with a **14-day free trial**; no card is required to start.
- Paid plans renew monthly or annually until cancelled. Cancelling keeps access until the end of the paid period.
- Prices exclude taxes where applicable. Indian customers are billed in INR through Razorpay; others in USD through Stripe.
- Government Enterprise terms are set in a separate order form, which prevails over these terms.

## Acceptable use

Do not reverse-engineer rate limits, scrape personal data, send unsolicited messages through the alert system, or use the service to mislead farmers.

## Data and content

You own the data you enter. You grant us a licence to process it to provide the service, and to use de-identified, aggregated data to improve models. Open-data sources remain under their own licences; see [Data sources](/docs/data-sources).

## Liability

To the extent the law allows, the service is provided "as is" and our total liability for any claim is limited to the fees you paid in the 12 months before the claim. Nothing limits liability that cannot be limited by law, including under consumer-protection law in India.

## Changes and termination

We will give 30 days' notice of material changes. You can close your account at any time; we may suspend accounts that breach these terms.

## Governing law

These terms are governed by the laws of India, with courts in New Delhi having jurisdiction, unless your local consumer law gives you the right to sue at home.

Contact: **legal@agrishield.io**.
`;

export const FAQ = `## General

### Is Agri-SHIELD free for farmers?

Yes. Farmer Basic (2 fields, 24-hour flood alerts, 5 SMS a month) is free with no time limit. Farmer Pro (₹199/month) adds salinity alerts, 72-hour lead time, the AI advisor and unlimited fields.

### Which countries are covered?

The demo monitors 22 districts in Bangladesh, Vietnam (Mekong Delta), the Philippines (Central Luzon), India (Odisha) and Indonesia (north Java). The data sources are global, so new districts can be added by defining a centroid, polygon and exposure factors.

### How accurate are the forecasts?

See [Flood model](/docs/methodology-flood) and [Salinity model](/docs/methodology-salinity). The scoring models are transparent and literature-based, but not yet fitted to a labelled flood archive. Treat them as decision support.

## Troubleshooting

### The map is blank or grey

Tile servers may be blocked by a corporate firewall. Allow \`server.arcgisonline.com\` (Esri dark and satellite basemaps) and \`gibs.earthdata.nasa.gov\` (NASA layers), or switch the basemap to **MODIS**.

### Values say "Seeded baseline" instead of live

The live refresh runs every 20 minutes when the app receives traffic. If Open-Meteo is unreachable (or \`AGRI_OFFLINE=true\`), the last good or seeded values are shown and labelled. Check \`/api/v1/health\` for the status of each source.

### I didn't get my sign-in code

In demo mode the code is always \`123456\`. In production, check the number includes the country code (for example \`+880\`), and that \`TWILIO_ACCOUNT_SID\`, \`TWILIO_AUTH_TOKEN\` and \`TWILIO_PHONE_NUMBER\` are set. Undelivered messages appear in the admin panel's outbox.

### The app doesn't work offline

Offline mode needs the service worker, which registers in production builds (or in development with \`NEXT_PUBLIC_SW_DEV=true\`). Open the farmer dashboard once while online so its data is cached. Cached data is kept for 72 hours.

### Actions I took offline didn't appear

Queued actions replay automatically when the browser regains a connection (Background Sync where supported, otherwise on the next \`online\` event while the app is open). You'll see a "Synced N offline actions" message.

### Rate limit exceeded

The API allows 100 requests per minute per user or IP. Batch requests where possible; tRPC batches automatically.

### Checkout says "sandbox"

No payment keys are configured. Set \`STRIPE_SECRET_KEY\` (and \`STRIPE_WEBHOOK_SECRET\`) or \`RAZORPAY_KEY_ID\`, \`RAZORPAY_KEY_SECRET\` (and \`RAZORPAY_WEBHOOK_SECRET\`) to switch to live checkout.
`;

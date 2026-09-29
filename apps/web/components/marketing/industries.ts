/**
 * Go-to-market content per buyer segment. Single source for the landing
 * industry switcher, /solutions/[industry], /roi presets and /book-demo.
 * Copy rules: plain language, no invented customers, every number either
 * comes from the live product or is an adjustable, labelled assumption.
 */
import type { RoiIndustry } from "./roi";

export type IndustryId = RoiIndustry;
export type ScreenKind = "portfolio" | "explorer" | "rules" | "insurance" | "finance" | "anticipatory" | "copilot" | "farmer" | "supply" | "government";

export interface DemoLogin {
  email: string;
  /** password login (demo2026) or OTP login (123456) */
  mode: "password" | "otp";
  who: string;
  home: string;
}

export interface IndustryContent {
  id: IndustryId;
  /** Plural buyer label used in the switcher: "Insurers" */
  label: string;
  /** Page title: "Agricultural insurance" */
  title: string;
  accent: string;
  headline: string;
  subhead: string;
  /** Three measurable outcomes (switcher + hero chips) */
  outcomes: { value: string; label: string }[];
  problem: { title: string; points: string[] };
  jobs: { job: string; how: string }[];
  screens: { kind: ScreenKind; caption: string }[];
  workflow: { title: string; detail: string }[];
  /** Overrides on top of ROI_PRESETS defaults for the worked example */
  roiExample: { scenario: string; inputs: Record<string, number>; plan: string };
  faqs: { q: string; a: string }[];
  demo: DemoLogin;
}

const pw = (email: string, who: string, home = "/app"): DemoLogin => ({ email, mode: "password", who, home });

export const INDUSTRIES: IndustryContent[] = [
  {
    id: "insurance",
    label: "Insurers",
    title: "Agricultural insurance",
    accent: "#38bdf8",
    headline: "Price, watch and settle crop cover with the same risk data.",
    subhead:
      "Score every policy and insured unit against this week's flood, salinity, drought and heat forecast, watch parametric triggers before they fire, and triage claims from satellite and forecast evidence instead of a field visit.",
    outcomes: [
      { value: "72 h", label: "notice before a rainfall trigger is likely to be hit" },
      { value: "Every policy", label: "re-scored daily against live forecasts" },
      { value: "Remote", label: "claims triage with satellite + river evidence" },
    ],
    problem: {
      title: "Crop books are priced once a season and watched rarely.",
      points: [
        "Exposure sits in spreadsheets of policy coordinates that nobody re-scores when the forecast changes.",
        "Parametric triggers fire as a surprise, so reserves and payout operations start late.",
        "Every indemnity claim needs a loss adjuster visit, which is slow and expensive in remote deltas.",
        "Basis risk (index says no loss, farmer had a loss) erodes trust and renewals.",
      ],
    },
    jobs: [
      { job: "Know where the book is exposed this week", how: "Portfolio view ranks every insured unit by composite risk with the driver in plain words (\"Heavy rain forecast, 142 mm in 72 h\")." },
      { job: "See a parametric trigger coming", how: "Alert rule on 72 h rainfall near your payout threshold notifies underwriting and finance by email, SMS or webhook." },
      { job: "Triage claims without a site visit", how: "Each plot's history holds the forecast, GloFAS river discharge and observed flood extent for the claim date." },
      { job: "Price new business anywhere", how: "Risk Explorer returns a full hazard report for any coordinate on Earth, not only districts you already cover." },
    ],
    screens: [
      { kind: "insurance", caption: "Insurance module · parametric trigger watch" },
      { kind: "portfolio", caption: "Portfolio · insured units ranked by live composite risk" },
      { kind: "rules", caption: "Alert rules · warn underwriting before a trigger" },
    ],
    workflow: [
      { title: "Import policies", detail: "Upload a CSV of policy ID, coordinates, crop, sum insured and product. Plots are scored within minutes." },
      { title: "Set trigger watches", detail: "One rule per product, e.g. \"72 h rain ≥ 120 mm on parametric plots → warn\"." },
      { title: "Act before the event", detail: "Send advisories to policyholders, pre-position loss adjusters, inform reinsurers." },
      { title: "Settle with evidence", detail: "Export a per-plot evidence pack (forecast, discharge, satellite) to support fast, defensible claims." },
    ],
    roiExample: { scenario: "Regional crop insurer, 25,000 policies, $25M sum insured", inputs: {}, plan: "business" },
    faqs: [
      { q: "Does this replace our actuarial model?", a: "No. Agri-SHIELD gives you current, location-level hazard scores and evidence. Your pricing and reserving models stay yours; the API lets you feed our scores into them." },
      { q: "Can it watch index products with our own trigger definitions?", a: "Yes. Alert rules take any metric we compute (72 h rainfall, flood probability, salinity EC, drought score, river discharge ratio) with your own thresholds and scope (tags, products, regions)." },
      { q: "Where does the data come from?", a: "Open-Meteo forecasts (ECMWF, GFS and national models), Copernicus GloFAS river discharge, NASA MODIS/VIIRS imagery and GDACS/EONET hazard events, combined with our flood and salinity models. Each number shows its source." },
      { q: "How is policyholder data protected?", a: "Each insurer gets an isolated workspace; staff see only their organisation's assets. Access is role-based and every change is written to an audit log. See the Trust page for details." },
    ],
    demo: pw("insurer@demo.agrishield.io", "Head of Agri Underwriting, illustrative insurer workspace (140 group-policy units, ~44,500 farmers)"),
  },
  {
    id: "banking",
    label: "Banks & MFIs",
    title: "Banks and microfinance",
    accent: "#a78bfa",
    headline: "See which borrowers the weather is about to hurt.",
    subhead:
      "Map your agricultural loan book, watch climate-driven expected loss by branch and crop, and reach borrowers with restructuring or advice before a flood or salt season turns into arrears.",
    outcomes: [
      { value: "Loan-level", label: "climate risk for every agri borrower" },
      { value: "Early", label: "restructuring watch-list before arrears" },
      { value: "Disclosure", label: "physical-risk reporting aligned to TCFD / ISSB S2" },
    ],
    problem: {
      title: "Credit models see the borrower, not the weather.",
      points: [
        "Agri loans default in clusters after floods, salt intrusion or dry spells, all in the same few districts.",
        "Loan officers visit every borrower on a schedule instead of the ones at risk this month.",
        "Regulators increasingly ask for physical climate-risk disclosure on the loan book.",
      ],
    },
    jobs: [
      { job: "Rank the book by climate exposure", how: "Portfolio view ranks loans by composite risk, filterable by crop, branch tag or internal rating." },
      { job: "Spot restructuring candidates early", how: "Finance module combines outstanding balance, days past due and forecast hazard into a watch-list." },
      { job: "Send officers where it matters", how: "Alert rules notify the branch when a borrower's area crosses your threshold." },
      { job: "Report physical risk", how: "Reports export exposure by hazard and region to CSV/PDF for disclosure." },
    ],
    screens: [
      { kind: "finance", caption: "Lending & Finance · climate-adjusted expected loss" },
      { kind: "portfolio", caption: "Portfolio · loans ranked by live composite risk" },
      { kind: "copilot", caption: "Copilot · ask the loan book in plain language" },
    ],
    workflow: [
      { title: "Connect the loan book", detail: "CSV or API import of loan ID, location, crop, outstanding and rating. Nothing personal is needed." },
      { title: "Set risk appetite", detail: "Rules such as \"composite > 70 on any loan → webhook to core banking\"." },
      { title: "Act through branches", detail: "Officers receive a weekly watch-list with the driver for each borrower." },
      { title: "Report", detail: "Quarterly physical-risk summary by hazard, crop and region." },
    ],
    roiExample: { scenario: "Rural bank, 8,000 agri loans, $40M outstanding", inputs: {}, plan: "enterprise" },
    faqs: [
      { q: "Do you need borrower personal data?", a: "No. A loan reference, approximate coordinates, crop and balance are enough. Names and IDs stay in your core banking system." },
      { q: "Can we push scores into our credit system?", a: "Yes. REST API and signed webhooks deliver scores and rule events; Enterprise includes higher limits and bulk import." },
      { q: "Is this a credit score?", a: "No. It is a physical climate-risk signal per location. Combine it with your own credit model; we show exactly which hazard drives each score." },
    ],
    demo: pw("bank@demo.agrishield.io", "Chief Risk Officer, illustrative rural bank workspace (160 agri loans)"),
  },
  {
    id: "agribusiness",
    label: "Agribusiness",
    title: "Agribusiness and food companies",
    accent: "#f59e0b",
    headline: "Move stock and sourcing before the water does.",
    subhead:
      "Watch warehouses, mills, ports and sourcing regions against live flood and salinity forecasts, model disruption to volume and price, and re-route with days of notice instead of hours.",
    outcomes: [
      { value: "Facility-level", label: "flood and salinity risk for every site" },
      { value: "3–7 days", label: "to re-route or pre-buy before disruption" },
      { value: "API", label: "risk scores straight into ERP and planning tools" },
    ],
    problem: {
      title: "Supply shocks are forecastable, but not in the systems that plan supply.",
      points: [
        "Weather sits in a separate app; procurement, logistics and finance each learn about a flood at different times.",
        "Short-notice re-routing costs expedite fees, demurrage and spot premiums.",
        "Sourcing regions exposed to salinity lose yield season after season without anyone quantifying it.",
      ],
    },
    jobs: [
      { job: "Know which facilities are exposed", how: "Portfolio view of every warehouse, mill and port with live composite risk and drivers." },
      { job: "Quantify disruption", how: "Scenario modelling estimates volume and price impact of a flood or salt season on each commodity." },
      { job: "Alert the right team", how: "Rules send Slack, email or webhook alerts to logistics when a site's flood probability crosses a threshold." },
    ],
    screens: [
      { kind: "supply", caption: "Supply network · facilities and flows at risk" },
      { kind: "portfolio", caption: "Portfolio · facilities ranked by live risk" },
      { kind: "rules", caption: "Alert rules · port and warehouse flood exposure" },
    ],
    workflow: [
      { title: "Map facilities", detail: "Import sites and sourcing regions (or connect your ERP via API)." },
      { title: "Set thresholds", detail: "Per site type: ports, warehouses, processing plants." },
      { title: "Plan ahead", detail: "Re-route shipments, move stock uphill, pre-buy from unaffected regions." },
      { title: "Review", detail: "Monthly report of avoided disruptions and exposure trend." },
    ],
    roiExample: { scenario: "Grain trader, 19 facilities, $60M sourced from exposed regions", inputs: {}, plan: "business" },
    faqs: [
      { q: "Does it integrate with our ERP?", a: "Yes, via REST API and signed webhooks. Sample integrations are documented in the integration guide." },
      { q: "Which regions are covered?", a: "Risk Explorer and portfolio scoring work for any coordinate on Earth. Salinity modelling is strongest in the Asian deltas we calibrated on (Ganges–Brahmaputra, Mekong, Mahanadi, Pampanga, Java north coast)." },
    ],
    demo: pw("supply@demo.agrishield.io", "Supply-chain admin, illustrative grain trader workspace (19 facilities)"),
  },
  {
    id: "government",
    label: "Governments",
    title: "Governments and disaster agencies",
    accent: "#22c55e",
    headline: "A district-level command centre for floods and salt.",
    subhead:
      "Rank districts by live flood and salinity risk, broadcast alerts to registered farmers by SMS and app, and pre-position pumps, seed and relief before the peak.",
    outcomes: [
      { value: "72 h", label: "district-level flood and salinity outlook" },
      { value: "SMS + app", label: "broadcast to farmers in their language" },
      { value: "Pre-positioned", label: "resources tracked from depot to district" },
    ],
    problem: {
      title: "Warnings exist, but they rarely reach the field in time or in a usable form.",
      points: [
        "National forecasts are not translated into district actions for extension officers.",
        "Relief equipment is dispatched after the water arrives.",
        "There is no shared picture across agriculture, disaster and water ministries.",
      ],
    },
    jobs: [
      { job: "Know which districts need attention", how: "Command dashboard ranks districts by live risk with farms and hectares affected." },
      { job: "Warn farmers", how: "Broadcast console sends SMS/app alerts with crop-specific advice in 8 languages." },
      { job: "Pre-position resources", how: "Resource tracking shows depots, coverage radius and requests by district." },
    ],
    screens: [
      { kind: "government", caption: "Government command dashboard · district risk" },
      { kind: "explorer", caption: "Risk Explorer · full report for any location" },
      { kind: "rules", caption: "Alert rules · district thresholds" },
    ],
    workflow: [
      { title: "Configure districts", detail: "We load your administrative boundaries and farmer registry (or start from open data)." },
      { title: "Train officers", detail: "Two-hour session per province; the dashboard is built for non-specialists." },
      { title: "Broadcast", detail: "Alerts go out by SMS, app and extension officer, with delivery tracking." },
      { title: "Review", detail: "Post-event reports: warnings sent, actions taken, losses avoided." },
    ],
    roiExample: { scenario: "Provincial agriculture department, $400M crop value", inputs: {}, plan: "gov_basic" },
    faqs: [
      { q: "Can we host it ourselves?", a: "Government Enterprise includes a self-hosted option; the web app and ML service ship as Docker images and all inputs are open data." },
      { q: "Does it work for farmers without smartphones?", a: "Yes. SMS alerts and SMS commands work on feature phones, and the farmer app works offline as a PWA." },
    ],
    demo: pw("gov@demo.agrishield.io", "Ministry officer, illustrative national agriculture ministry"),
  },
  {
    id: "ngo",
    label: "NGOs",
    title: "NGOs and anticipatory action",
    accent: "#f472b6",
    headline: "Release help before the peak, on triggers agreed in advance.",
    subhead:
      "Monitor the communities in your programme, define forecast-based triggers with your donors, and get a clear, auditable signal to release cash or supplies days before a flood or cyclone.",
    outcomes: [
      { value: "Pre-agreed", label: "triggers tied to forecast probability" },
      { value: "Days", label: "of lead time to move cash and supplies" },
      { value: "Auditable", label: "record of every trigger and decision for donors" },
    ],
    problem: {
      title: "Humanitarian money usually arrives after the damage.",
      points: [
        "Response starts when the water is already in the house.",
        "Trigger decisions are argued in meetings instead of being agreed beforehand.",
        "Donors want evidence that anticipatory funds were released on objective signals.",
      ],
    },
    jobs: [
      { job: "Watch every community", how: "Portfolio of communities with households, population and shelter distance, scored against the forecast." },
      { job: "Trigger on objective signals", how: "Anticipatory Action module: readiness → activation stages linked to flood probability and lead time." },
      { job: "Coordinate field teams", how: "Alerts by SMS and WhatsApp to field coordinators, with a checklist per stage." },
    ],
    screens: [
      { kind: "anticipatory", caption: "Anticipatory Action · trigger stages per community" },
      { kind: "portfolio", caption: "Portfolio · communities ranked by live risk" },
      { kind: "copilot", caption: "Copilot · which communities cross the trigger this week?" },
    ],
    workflow: [
      { title: "Import communities", detail: "Locations, households and pre-arranged cash envelopes from your programme database." },
      { title: "Agree triggers", detail: "Readiness at 50% flood probability, activation at 70% within 72 h (your thresholds)." },
      { title: "Release early", detail: "Field teams receive the activation with the list of communities and amounts." },
      { title: "Report to donors", detail: "Export the trigger log with forecast evidence at the time of each decision." },
    ],
    roiExample: { scenario: "NGO programme, 25,000 households in 48 coastal communities", inputs: {}, plan: "business" },
    faqs: [
      { q: "Is there a discount for NGOs?", a: "Yes, registered NGOs receive 50% off list price. Book a demo and mention your registration." },
      { q: "Can triggers match our existing protocol?", a: "Yes. Stages, thresholds, lead times and scope are all configurable per programme." },
    ],
    demo: pw("ngo@demo.agrishield.io", "Anticipatory Action lead, illustrative NGO workspace (48 communities)"),
  },
  {
    id: "cooperative",
    label: "Co-ops",
    title: "Farmer co-operatives",
    accent: "#34d399",
    headline: "One screen for every member's fields, one message to all of them.",
    subhead:
      "See flood, salinity and dry-spell risk across member farms, send advisories in the members' own language, and time sluice gates, harvest and input purchases as a group.",
    outcomes: [
      { value: "Every member", label: "farm monitored against live forecasts" },
      { value: "8 languages", label: "SMS and app advisories" },
      { value: "Group", label: "decisions on sluices, harvest and inputs" },
    ],
    problem: {
      title: "Co-ops advise hundreds of farms with a handful of staff.",
      points: [
        "Agronomists visit farms in rotation, not by risk.",
        "Members hear about salt intrusion or floods from neighbours, too late.",
        "Collective decisions (closing a sluice, early harvest) need a shared, trusted signal.",
      ],
    },
    jobs: [
      { job: "Know which members are at risk", how: "Portfolio of member farms with crop, area and live risk." },
      { job: "Advise everyone at once", how: "Rules send SMS or app advisories to members in affected areas." },
      { job: "Decide together", how: "Explorer and Copilot give the committee a clear view of the next 72 h and 30 days." },
    ],
    screens: [
      { kind: "portfolio", caption: "Portfolio · member farms by live risk" },
      { kind: "farmer", caption: "Farmer app · what members see on their phone" },
      { kind: "rules", caption: "Alert rules · salinity advisory for rice members" },
    ],
    workflow: [
      { title: "Register members", detail: "Import the member list with farm locations and crops." },
      { title: "Choose advisories", detail: "Pick thresholds and messages; members get them in their language." },
      { title: "Act as a group", detail: "Committee reviews weekly outlook; staff visit flagged farms first." },
      { title: "Show results", detail: "Season report for the board and lenders." },
    ],
    roiExample: { scenario: "Producer co-op, 900 member farms, $1.4M crop value", inputs: {}, plan: "business_nonprofit" },
    faqs: [
      { q: "Do members need smartphones?", a: "No. SMS works on any phone; members with smartphones get the full farmer app for free." },
      { q: "Is there a co-operative discount?", a: "Yes, registered co-operatives receive 50% off list price." },
    ],
    demo: pw("coop@demo.agrishield.io", "CEO, illustrative producer co-operative workspace (90 member farms)"),
  },
  {
    id: "farmers",
    label: "Farmers",
    title: "Farmers",
    accent: "#4ade80",
    headline: "Know three days ahead. Free, in your language.",
    subhead:
      "Flood warnings for your own fields, saltwater alerts before the canal turns salty, and plain advice on what to do, by app or SMS, in 8 languages.",
    outcomes: [
      { value: "Free", label: "flood alerts forever (Farmer Basic)" },
      { value: "72 h", label: "flood + salinity warnings with Farmer Pro" },
      { value: "8", label: "languages, app or SMS" },
    ],
    problem: {
      title: "Farmers find out when the water is already in the field.",
      points: ["Weather apps give rain in millimetres, not what to do.", "Salt reaches the canal before anyone warns the village.", "Advice is rarely in the farmer's own language."],
    },
    jobs: [
      { job: "Know if my field will flood", how: "72 h flood probability for each field, with a clear action (\"Drain seedbeds today\")." },
      { job: "Protect against salt", how: "Salinity forecast with safe irrigation windows and salt-tolerant seed advice." },
      { job: "Ask a question", how: "AI farm advisor answers in the farmer's language (Farmer Pro)." },
    ],
    screens: [
      { kind: "farmer", caption: "Farmer app · field risk and today's action" },
      { kind: "explorer", caption: "Any field, anywhere · the same risk engine" },
    ],
    workflow: [
      { title: "Sign up with your phone", detail: "One-time code, no password." },
      { title: "Draw your fields", detail: "Tap the corners on the map." },
      { title: "Get warnings", detail: "App notification or SMS when your field is at risk." },
      { title: "Act and record", detail: "Log what you did; see what it saved." },
    ],
    roiExample: { scenario: "Rice farmer, 1.2 ha, two fields", inputs: {}, plan: "farmer_pro" },
    faqs: [
      { q: "Is it really free?", a: "Farmer Basic (flood alerts 24 h ahead, 2 fields) is free forever. Farmer Pro is ₹199 / $3 a month with a 14-day free trial." },
      { q: "What if I have no internet?", a: "Alerts also come by SMS, and you can reply with simple SMS commands." },
    ],
    demo: { email: "farmer@demo.agrishield.io", mode: "otp", who: "Illustrative rice farmer in Barisal, Bangladesh", home: "/dashboard/farmer" },
  },
];

export const industryById = (id: string) => INDUSTRIES.find((i) => i.id === id);

/** Company size bands for the demo form */
export const COMPANY_SIZES = ["1–10", "11–50", "51–200", "201–1,000", "1,001–5,000", "5,000+"];

/** Use cases offered on the demo form, keyed by industry */
export const USE_CASES: Record<IndustryId, string[]> = {
  insurance: ["Parametric trigger monitoring", "Portfolio risk scoring", "Claims triage", "Pricing new regions"],
  banking: ["Loan-book climate risk", "Early restructuring watch-list", "Physical-risk disclosure", "New-market credit screening"],
  agribusiness: ["Facility flood exposure", "Sourcing-region risk", "Disruption scenarios", "ERP / API integration"],
  government: ["District early warning", "Farmer SMS broadcast", "Resource pre-positioning", "Post-event reporting"],
  ngo: ["Anticipatory action triggers", "Community monitoring", "Donor reporting", "Field-team alerts"],
  cooperative: ["Member farm monitoring", "Group advisories", "Sluice / harvest timing", "Board reporting"],
  farmers: ["Flood alerts for my fields", "Salinity alerts", "Farm advisor", "Other"],
};

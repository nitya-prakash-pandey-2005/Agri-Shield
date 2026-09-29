/** Docs table of contents. Order here = sidebar order = prev/next order. */
import { FARMERS, GETTING_STARTED, GOVERNMENTS, SUPPLY_CHAIN } from "./content/getting-started";
import { IMPACT_METHODOLOGY, METHODOLOGY_FLOOD, METHODOLOGY_SALINITY, SUPPLY_CHAIN_MODEL } from "./content/methodology";
import { DATA_SOURCES, FAQ, PRIVACY, SECURITY, TERMS } from "./content/data-sources";
import { API_REFERENCE, INTEGRATION_GUIDE, TRPC_REFERENCE, ML_API } from "./content/api";

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  summary: string;
  body: string;
}

export const DOCS: DocPage[] = [
  { slug: "getting-started", group: "Getting started", title: "Overview & demo accounts", summary: "What Agri-SHIELD does, what is live, and how to try every portal in two minutes.", body: GETTING_STARTED },
  { slug: "farmers", group: "Getting started", title: "For farmers", summary: "Sign up, add fields, read alerts, act offline, SMS commands.", body: FARMERS },
  { slug: "governments", group: "Getting started", title: "For governments", summary: "Roles, the command-centre workflow, resources and broadcasts.", body: GOVERNMENTS },
  { slug: "supply-chain", group: "Getting started", title: "For supply chains", summary: "Network risk, commodity exposure, scenarios and webhooks.", body: SUPPLY_CHAIN },
  { slug: "api-reference", group: "Developers", title: "REST API reference", summary: "/api/v1 endpoints: risk, health, SMS inbound, alert webhook, OpenAPI.", body: API_REFERENCE },
  { slug: "ml-api", group: "Developers", title: "ML service API", summary: "FastAPI endpoints for flood, salinity, advisor, scenarios and metrics.", body: ML_API },
  { slug: "trpc", group: "Developers", title: "tRPC routers", summary: "Every router and procedure the web app uses, with access rules.", body: TRPC_REFERENCE },
  { slug: "integration-guide", group: "Developers", title: "Integration guide", summary: "API keys, webhook payloads and HMAC signature verification in Node and Python.", body: INTEGRATION_GUIDE },
  { slug: "methodology-flood", group: "Methodology", title: "Flood model", summary: "Drivers, formulas, thresholds, validation status and limitations.", body: METHODOLOGY_FLOOD },
  { slug: "methodology-salinity", group: "Methodology", title: "Salinity model", summary: "EC forecasting, seasonal intrusion, FAO crop tolerance thresholds.", body: METHODOLOGY_SALINITY },
  { slug: "supply-chain-model", group: "Methodology", title: "Supply-chain impact", summary: "Node risk, commodity disruption, price impact and scenarios.", body: SUPPLY_CHAIN_MODEL },
  { slug: "impact-methodology", group: "Methodology", title: "Impact metrics", summary: "Which numbers are live, derived or simulated, and how they are computed.", body: IMPACT_METHODOLOGY },
  { slug: "data-sources", group: "Reference", title: "Data sources & licences", summary: "Every open-data source, what it feeds, and its attribution.", body: DATA_SOURCES },
  { slug: "security", group: "Reference", title: "Security overview", summary: "Auth, RBAC, rate limits, signatures, headers, audit log.", body: SECURITY },
  { slug: "faq", group: "Reference", title: "FAQ & troubleshooting", summary: "Coverage, accuracy, maps, OTPs, offline mode, checkout.", body: FAQ },
  { slug: "privacy", group: "Legal", title: "Privacy policy", summary: "GDPR and India DPDP Act 2023 aware privacy policy.", body: PRIVACY },
  { slug: "terms", group: "Legal", title: "Terms of service", summary: "Plans, trials, acceptable use, liability.", body: TERMS },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);

/** Plain-text search index (sent to the client sidebar). */
export function searchIndex() {
  return DOCS.map((d) => ({
    slug: d.slug,
    title: d.title,
    group: d.group,
    summary: d.summary,
    text: d.body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*|`[\]()-]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 6000),
  }));
}
export type SearchEntry = ReturnType<typeof searchIndex>[number];

/**
 * Supply-chain portal state that complements the shared store:
 *  - API key hashes (the shared ApiKeyRecord only keeps the display prefix)
 *  - webhook delivery log (every signed POST we make, with status + latency)
 *  - webhook display names and evaluation de-duplication
 *  - saved Monte Carlo scenarios (for side-by-side comparison)
 * Kept on globalThis so Next.js hot reload doesn't drop it.
 */
import type { ScenarioRun } from "../services/supply-chain";

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  orgId: string;
  event: string;
  url: string;
  at: Date;
  status: number | null;
  ok: boolean;
  latencyMs: number | null;
  signature: string;
  requestBody: string;
  responseSnippet: string | null;
  error: string | null;
  trigger: "test" | "evaluation";
}

interface ScState {
  keyHashes: Map<string, string>; // apiKey.id → sha256(full key)
  deliveries: WebhookDelivery[];
  webhookNames: Map<string, string>;
  /** webhookId|commodity → last risk score delivered (suppresses duplicates) */
  lastFired: Map<string, { at: number; score: number }>;
  scenarios: ScenarioRun[];
}

const g = globalThis as unknown as { __agriScState?: ScState };

export function scState(): ScState {
  return (g.__agriScState ??= {
    keyHashes: new Map(),
    deliveries: [],
    webhookNames: new Map(),
    lastFired: new Map(),
    scenarios: [],
  });
}

export function logDelivery(d: WebhookDelivery) {
  const s = scState();
  s.deliveries.unshift(d);
  if (s.deliveries.length > 300) s.deliveries.length = 300;
}

export function saveScenario(run: ScenarioRun) {
  const s = scState();
  s.scenarios.unshift(run);
  // keep the latest 20 per org
  const perOrg = new Map<string, number>();
  s.scenarios = s.scenarios.filter((r) => {
    const n = (perOrg.get(r.orgId) ?? 0) + 1;
    perOrg.set(r.orgId, n);
    return n <= 20;
  });
}

/**
 * supplyChainRouter — procedures for this portal. Guarded by the "view_supply_chain" permission.
 */
import { permitted, router } from "../trpc";

const proc = permitted("view_supply_chain");

export const supplyChainRouter = router({
  ping: proc.query(() => ({ ok: true })),
});

/**
 * farmerRouter — procedures for this portal. Guarded by the "view_farm_data" permission.
 */
import { permitted, router } from "../trpc";

const proc = permitted("view_farm_data");

export const farmerRouter = router({
  ping: proc.query(() => ({ ok: true })),
});

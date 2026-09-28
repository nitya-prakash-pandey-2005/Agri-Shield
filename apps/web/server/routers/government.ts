/**
 * governmentRouter — procedures for this portal. Guarded by the "view_gov_dashboard" permission.
 */
import { permitted, router } from "../trpc";

const proc = permitted("view_gov_dashboard");

export const governmentRouter = router({
  ping: proc.query(() => ({ ok: true })),
});

/**
 * adminRouter — procedures for this portal. Guarded by the "access_admin_panel" permission.
 */
import { permitted, router } from "../trpc";

const proc = permitted("access_admin_panel");

export const adminRouter = router({
  ping: proc.query(() => ({ ok: true })),
});

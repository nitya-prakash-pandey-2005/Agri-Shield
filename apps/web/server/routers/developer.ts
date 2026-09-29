/**
 * developerRouter — workspace module procedures. Guarded by "use_workspace"; always scope data to ctx.user.orgId.
 */
import { permitted, router } from "../trpc";

const proc = permitted("use_workspace");

export const developerRouter = router({
  ping: proc.query(() => ({ ok: true })),
});

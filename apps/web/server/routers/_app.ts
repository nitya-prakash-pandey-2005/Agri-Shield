import { router } from "../trpc";
import { publicRouter } from "./public";
import { authRouter } from "./auth";
import { mlRouter } from "./ml";
import { farmerRouter } from "./farmer";
import { governmentRouter } from "./government";
import { supplyChainRouter } from "./supplyChain";
import { adminRouter } from "./admin";
import { billingRouter } from "./billing";

export const appRouter = router({
  public: publicRouter,
  auth: authRouter,
  ml: mlRouter,
  farmer: farmerRouter,
  government: governmentRouter,
  supplyChain: supplyChainRouter,
  admin: adminRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;

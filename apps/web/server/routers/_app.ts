import { router } from "../trpc";
import { workspaceRouter } from "./workspace";
import { explorerRouter } from "./explorer";
import { portfolioRouter } from "./portfolio";
import { insuranceRouter } from "./insurance";
import { financeRouter } from "./finance";
import { copilotRouter } from "./copilot";
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
  workspace: workspaceRouter,
  explorer: explorerRouter,
  portfolio: portfolioRouter,
  insurance: insuranceRouter,
  finance: financeRouter,
  copilot: copilotRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;

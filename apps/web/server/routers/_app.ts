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
import { twinRouter } from "./twin";
import { simulateRouter } from "./simulate";
import { incidentsRouter } from "./incidents";
import { sensorsRouter } from "./sensors";
import { sustainabilityRouter } from "./sustainability";
import { dashboardsRouter } from "./dashboards";
import { imageryRouter } from "./imagery";
import { developerRouter } from "./developer";

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
  twin: twinRouter,
  simulate: simulateRouter,
  incidents: incidentsRouter,
  sensors: sensorsRouter,
  sustainability: sustainabilityRouter,
  dashboards: dashboardsRouter,
  imagery: imageryRouter,
  developer: developerRouter,
});

export type AppRouter = typeof appRouter;

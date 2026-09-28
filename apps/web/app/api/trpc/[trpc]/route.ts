import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") console.error(`[tRPC] ${path}:`, error);
    },
  });

export { handler as GET, handler as POST };

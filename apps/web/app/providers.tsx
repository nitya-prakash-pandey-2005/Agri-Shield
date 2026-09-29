"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink, loggerLink, TRPCClientError } from "@trpc/client";
import { SessionProvider } from "next-auth/react";
import { useState } from "react";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { AppThemeProvider } from "@/components/theme/ThemeProvider";

/** 4xx answers the UI handles itself (sign-in required, onboarding, forbidden, rate limit…). */
const EXPECTED = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "TOO_MANY_REQUESTS", "BAD_REQUEST", "CONFLICT"]);
function isExpectedClientError(err: unknown): boolean {
  if (!(err instanceof TRPCClientError)) return false;
  const code = (err.data as { code?: string } | undefined)?.code;
  return !!code && EXPECTED.has(code);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            // Retry network/server hiccups once; never retry deliberate 4xx answers
            retry: (count, err) => !isExpectedClientError(err) && count < 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (op) => process.env.NODE_ENV === "development" && op.direction === "down" && op.result instanceof Error && !isExpectedClientError(op.result),
        }),
        // Streamed batches: each query resolves as soon as its own result is ready,
        // so one slow upstream (e.g. a hazard feed) never holds up the whole page.
        httpBatchStreamLink({ url: "/api/trpc", transformer: superjson }),
      ],
    })
  );

  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {/* Appearance: themes, Solar Auto, accent, motion (components/theme) */}
          <AppThemeProvider>{children}</AppThemeProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
}

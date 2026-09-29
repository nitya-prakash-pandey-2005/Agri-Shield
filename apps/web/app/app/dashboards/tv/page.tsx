"use client";

/** TV mode: /app/dashboards/tv?ids=<id,id>&every=<seconds> — full-screen, auto-refresh, rotation. */
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense } from "react";
import { TvMode } from "@/components/dashboards/Board";
import { trpc } from "@/lib/trpc";

function Inner() {
  const params = useSearchParams();
  const { data: session } = useSession();
  const list = trpc.dashboards.list.useQuery(undefined, { staleTime: 60_000 });
  const fromUrl = (params.get("ids") ?? "").split(",").filter(Boolean);
  const ids = fromUrl.length ? fromUrl : list.data?.filter((d) => d.isDefault).map((d) => d.id) ?? [];
  const every = Math.max(10, Math.min(3600, Number(params.get("every")) || 60));
  if (!fromUrl.length && list.isLoading) return null;
  return <TvMode ids={ids} every={every} orgId={session?.user?.orgId ?? null} />;
}

export default function TvPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

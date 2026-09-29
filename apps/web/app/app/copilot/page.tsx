import type { Metadata } from "next";
import { CopilotPage } from "@/components/copilot/CopilotPage";

export const metadata: Metadata = { title: "Copilot" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 500) : null;
  return <CopilotPage initialQuestion={q} />;
}

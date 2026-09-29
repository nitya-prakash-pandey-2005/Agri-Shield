import type { MetadataRoute } from "next";
import { DOCS } from "@/components/docs/registry";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://agrishield.io").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/pitch`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE}/auth/signup`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/auth/signin`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  return [...pages, ...DOCS.map((d) => ({ url: `${BASE}/docs/${d.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: d.group === "Legal" ? 0.3 : 0.6 }))];
}

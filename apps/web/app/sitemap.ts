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
    { url: `${BASE}/explore`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...["insurance", "banking", "agribusiness", "government", "ngo", "cooperative", "farmers"].map((i) => ({ url: `${BASE}/solutions/${i}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${BASE}/solutions`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/roi`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/customers`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/book-demo`, lastModified: now, changeFrequency: "yearly", priority: 0.7 },
    { url: `${BASE}/help`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/help/glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "hourly", priority: 0.4 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.4 },
    { url: `${BASE}/trust`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/auth/signup`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${BASE}/auth/signin`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  return [...pages, ...DOCS.map((d) => ({ url: `${BASE}/docs/${d.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: d.group === "Legal" ? 0.3 : 0.6 }))];
}

import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "https://agrishield.io").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/pitch", "/docs", "/api/v1/openapi.json"],
        disallow: ["/dashboard", "/admin", "/onboarding", "/api/", "/pricing/checkout", "/offline"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}

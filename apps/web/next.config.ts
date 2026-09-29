import type { NextConfig } from "next";

/**
 * Security headers (spec §18) — strict CSP allow-list of exactly the hosts the
 * platform talks to from the browser, HSTS, frame denial, permissions policy.
 * Server-side fetches (Open-Meteo, GDACS, EONET, MODIS, MyMemory…) are not
 * subject to CSP, so they are intentionally NOT in connect-src.
 */
const isDev = process.env.NODE_ENV !== "production";

const mlOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_ML_API_URL ?? process.env.ML_API_URL ?? "http://localhost:8000").origin;
  } catch {
    return "";
  }
})();

const TILE_HOSTS = [
  "https://server.arcgisonline.com",
  "https://services.arcgisonline.com",
  "https://gibs.earthdata.nasa.gov",
  "https://*.tile.openstreetmap.org",
  "https://tile.openstreetmap.org",
  "https://tilecache.rainviewer.com", // live precipitation radar
  "https://storage.googleapis.com", // JRC Global Surface Water tiles
];

const csp = [
  "default-src 'self'",
  // Next.js inline bootstrap needs 'unsafe-inline'; 'unsafe-eval' only for dev HMR / react-refresh
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${TILE_HOSTS.join(" ")}`,
  `connect-src 'self' ws: wss: ${mlOrigin} ${TILE_HOSTS.join(" ")}`.replace(/\s+/g, " ").trim(),
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

/** CORS allow-list for the public REST API (spec §18). */
const API_ORIGINS = (process.env.CORS_ORIGINS ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").split(",")[0]!.trim();

const nextConfig: NextConfig = {
  // Allows parallel dev servers (e.g. NEXT_DIST_DIR=.next-gov next dev -p 3102)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@agri-shield/db", "@agri-shield/types"],
  // BullMQ loads Lua scripts from its package dir at runtime — never bundle it.
  // web-push is Node-only (crypto/https): load it with require() on the server.
  serverExternalPackages: ["bullmq", "ioredis", "web-push"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "earthengine.googleapis.com" },
      { protocol: "https", hostname: "tile.openstreetmap.org" },
      { protocol: "https", hostname: "api.mapbox.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_ML_API_URL: process.env.NEXT_PUBLIC_ML_API_URL ?? "http://localhost:8000",
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/api/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: API_ORIGINS },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-API-Key, X-Signature, Authorization" },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

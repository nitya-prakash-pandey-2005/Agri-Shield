#!/usr/bin/env node
/**
 * Generates every PWA / favicon / social image for apps/web/public from a
 * single hand-drawn SVG shield mark (no external assets, no network).
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs (apps/web/public):
 *   icon.svg                 — vector favicon (modern browsers)
 *   favicon.ico              — 16/32/48 PNG-in-ICO
 *   icon-192.png, icon-512.png           — "any" purpose
 *   icon-maskable-192.png, icon-maskable-512.png — full-bleed, 60% safe zone
 *   apple-touch-icon.png     — 180×180, opaque
 *   badge-72.png             — monochrome notification badge
 *   shortcut-alerts.png, shortcut-advisor.png, shortcut-map.png — 96×96
 *   og-image.png             — 1200×630 social card
 *   globe/land-mask.png      — 720×360 equirectangular land mask (NASA GIBS OSM_Land_Water_Map)
 *   globe/asia-dots.svg      — static orthographic dot-globe centred on Asia (reduced-motion fallback)
 *
 * `sharp` ships transitively with Next.js; we resolve it from the pnpm store.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps", "web", "public");
mkdirSync(out, { recursive: true });

function loadSharp() {
  const candidates = [
    join(root, "apps", "web", "package.json"),
    join(root, "node_modules", ".pnpm", "node_modules", "sharp", "package.json"),
    join(root, "package.json"),
  ];
  for (const c of candidates) {
    try {
      return createRequire(c)(c.includes("sharp") ? dirname(c) : "sharp");
    } catch {
      /* try next */
    }
  }
  throw new Error("sharp not found — run `pnpm install` first (it ships with next).");
}
const sharp = loadSharp();

// ─── The mark ────────────────────────────────────────────────────────────────
// Shield outline (emerald), a rice sprout rising out of it, two tidal waves
// (cyan = flood water, amber = salt front). Drawn on a 512 grid.
const MARK = `
  <defs>
    <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4ade80"/>
      <stop offset="1" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b2a1f"/>
      <stop offset="1" stop-color="#061423"/>
    </linearGradient>
    <clipPath id="inner"><path d="M256 92 L384 138 V250 C384 334 330 392 256 424 C182 392 128 334 128 250 V138 Z"/></clipPath>
  </defs>
  <path d="M256 72 L402 124 V252 C402 348 340 414 256 450 C172 414 110 348 110 252 V124 Z" fill="url(#fill)" stroke="url(#sh)" stroke-width="20" stroke-linejoin="round"/>
  <g clip-path="url(#inner)">
    <path d="M120 318 C160 296 196 296 236 318 S312 340 352 318 S392 300 400 304 V440 H120 Z" fill="#0ea5e9" opacity="0.9"/>
    <path d="M120 352 C160 332 196 332 236 352 S312 372 352 352 S392 336 400 340 V440 H120 Z" fill="#f59e0b" opacity="0.95"/>
  </g>
  <path d="M256 318 V186" stroke="#4ade80" stroke-width="16" stroke-linecap="round"/>
  <path d="M256 236 C256 196 284 170 324 166 C322 206 296 232 256 236 Z" fill="#4ade80"/>
  <path d="M256 262 C256 226 230 204 194 200 C196 236 220 258 256 262 Z" fill="#22c55e"/>
`;

const iconSvg = (opts = {}) => {
  const { bg = true, scale = 1, radius = 112 } = opts;
  const t = (1 - scale) * 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ${bg ? `<defs><radialGradient id="bg" cx="0.5" cy="0.35" r="0.75"><stop offset="0" stop-color="#0c2b22"/><stop offset="1" stop-color="#050b16"/></radialGradient></defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>` : ""}
  <g transform="translate(${t} ${t}) scale(${scale})">${MARK}</g>
</svg>`;
};

const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 72 L402 124 V252 C402 348 340 414 256 450 C172 414 110 348 110 252 V124 Z" fill="#fff"/></svg>`;

const shortcutSvg = (glyph, color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="22" fill="#07101f"/><rect x="2" y="2" width="92" height="92" rx="20" fill="none" stroke="${color}" stroke-opacity="0.5" stroke-width="2"/>
  <g fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;

const SHORTCUTS = {
  alerts: shortcutSvg('<path d="M48 22 L74 70 H22 Z"/><path d="M48 42 V54"/><circle cx="48" cy="62" r="1.5"/>', "#f87171"),
  advisor: shortcutSvg('<path d="M24 30 H72 V60 H46 L32 72 V60 H24 Z"/><path d="M36 44 H60"/>', "#4ade80"),
  map: shortcutSvg('<path d="M20 28 L38 22 L58 30 L76 24 V68 L58 74 L38 66 L20 72 Z"/><path d="M38 22 V66 M58 30 V74"/>', "#38bdf8"),
};

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="g1" cx="0.8" cy="0.2" r="0.7"><stop offset="0" stop-color="#0e3b2c"/><stop offset="1" stop-color="#050a14" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.1" cy="1" r="0.6"><stop offset="0" stop-color="#0b2d45"/><stop offset="1" stop-color="#050a14" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 H0 V40" fill="none" stroke="#94a3b8" stroke-opacity="0.07"/></pattern>
  </defs>
  <rect width="1200" height="630" fill="#050a14"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  <g transform="translate(905 175) scale(0.54)">${MARK}</g>
  <circle cx="1043" cy="316" r="200" fill="none" stroke="#34d399" stroke-opacity="0.18"/>
  <circle cx="1043" cy="316" r="160" fill="none" stroke="#38bdf8" stroke-opacity="0.12" stroke-dasharray="4 10"/>
  <text x="80" y="120" font-family="Consolas, 'JetBrains Mono', monospace" font-size="22" fill="#34d399" letter-spacing="4">AGRI-SHIELD · CLIMATE DECISION INTELLIGENCE</text>
  <text x="80" y="232" font-family="'Segoe UI', 'Space Grotesk', Arial, sans-serif" font-size="60" font-weight="700" fill="#f8fafc">Act before the flood hits.</text>
  <text x="80" y="316" font-family="'Segoe UI', 'Space Grotesk', Arial, sans-serif" font-size="60" font-weight="700" fill="#fbbf24">Save before the salt spreads.</text>
  <text x="80" y="392" font-family="'Segoe UI', Arial, sans-serif" font-size="28" fill="#94a3b8">72-hour flood &amp; salinity intelligence for farmers,</text>
  <text x="80" y="432" font-family="'Segoe UI', Arial, sans-serif" font-size="28" fill="#94a3b8">governments and supply chains across Asia.</text>
  <g font-family="Consolas, 'JetBrains Mono', monospace" font-size="18" fill="#cbd5e1">
    <rect x="80" y="500" width="236" height="44" rx="8" fill="#0f172a" stroke="#1e293b"/><text x="100" y="528">OPEN-METEO · GloFAS</text>
    <rect x="332" y="500" width="150" height="44" rx="8" fill="#0f172a" stroke="#1e293b"/><text x="352" y="528">NASA GIBS</text>
    <rect x="498" y="500" width="190" height="44" rx="8" fill="#0f172a" stroke="#1e293b"/><text x="518" y="528">GDACS · EONET</text>
  </g>
</svg>`;

async function png(svg, size, file, { flatten } = {}) {
  let p = sharp(Buffer.from(svg), { density: 384 }).resize(size, size);
  if (flatten) p = p.flatten({ background: flatten });
  const buf = await p.png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(out, file), buf);
  console.log(`  ✓ ${file} (${size}×${size}, ${(buf.length / 1024).toFixed(1)} KB)`);
  return buf;
}

/** Minimal ICO writer: PNG-compressed entries (supported by all modern browsers). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

console.log("Agri-SHIELD icon pipeline →", out);
writeFileSync(join(out, "icon.svg"), iconSvg());
console.log("  ✓ icon.svg");
await png(iconSvg(), 192, "icon-192.png");
await png(iconSvg(), 512, "icon-512.png");
await png(iconSvg({ radius: 0, scale: 0.78 }), 192, "icon-maskable-192.png");
await png(iconSvg({ radius: 0, scale: 0.78 }), 512, "icon-maskable-512.png");
await png(iconSvg({ radius: 0, scale: 0.86 }), 180, "apple-touch-icon.png", { flatten: "#050b16" });
await png(badgeSvg, 72, "badge-72.png");
for (const [k, svg] of Object.entries(SHORTCUTS)) await png(svg, 96, `shortcut-${k}.png`);

const icoParts = [];
for (const size of [16, 32, 48]) {
  const buf = await sharp(Buffer.from(iconSvg({ radius: 96 })), { density: 144 }).resize(size, size).png().toBuffer();
  icoParts.push({ size, buf });
}
writeFileSync(join(out, "favicon.ico"), ico(icoParts));
console.log("  ✓ favicon.ico (16/32/48)");

const og = await sharp(Buffer.from(ogSvg), { density: 144 }).resize(1200, 630).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(join(out, "og-image.png"), og);
console.log(`  ✓ og-image.png (1200×630, ${(og.length / 1024).toFixed(1)} KB)`);
// ─── Globe land mask (needs network once; skipped gracefully offline) ────────
const GLOBE_CENTER = { lat: 15, lon: 100 };
try {
  const url =
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=OSM_Land_Water_Map&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=720&HEIGHT=360&FORMAT=image/png";
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`GIBS ${res.status}`);
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mask = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = data[i] < 100 ? 255 : 0; // land ≈ 75, water ≈ 128
  mkdirSync(join(out, "globe"), { recursive: true });
  await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).png({ compressionLevel: 9, palette: true, colours: 2 }).toFile(join(out, "globe", "land-mask.png"));
  console.log("  ✓ globe/land-mask.png (720×360)");

  // Orthographic dot globe (SVG, 600×600) centred on Asia
  const R = 290, C = 300, step = 1.6;
  const la0 = (GLOBE_CENTER.lat * Math.PI) / 180, lo0 = (GLOBE_CENTER.lon * Math.PI) / 180;
  const dots = [];
  for (let lat = -88; lat <= 88; lat += step) {
    const lonStep = step / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (let lon = -180; lon < 180; lon += lonStep) {
      const px = Math.floor(((lon + 180) / 360) * W), py = Math.floor(((90 - lat) / 180) * H);
      if (!mask[py * W + px]) continue;
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      const cosc = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * Math.cos(la) * Math.cos(lo - lo0);
      if (cosc <= 0.02) continue;
      const x = C + R * Math.cos(la) * Math.sin(lo - lo0);
      const y = C - R * (Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(lo - lo0));
      dots.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><radialGradient id="o" cx="0.42" cy="0.38" r="0.7"><stop offset="0" stop-color="#0d2238"/><stop offset="1" stop-color="#050b16"/></radialGradient><radialGradient id="a" cx="0.5" cy="0.5" r="0.5"><stop offset="0.9" stop-color="#34d399" stop-opacity="0"/><stop offset="0.97" stop-color="#34d399" stop-opacity="0.35"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></radialGradient></defs><circle cx="300" cy="300" r="300" fill="url(#a)"/><circle cx="300" cy="300" r="${R}" fill="url(#o)" stroke="#34d399" stroke-opacity="0.25"/><path d="${dots.join("")}" stroke="#5eead4" stroke-opacity="0.55" stroke-width="2.6" stroke-linecap="round"/></svg>`;
  writeFileSync(join(out, "globe", "asia-dots.svg"), svg);
  console.log(`  ✓ globe/asia-dots.svg (${dots.length} land dots, ${(svg.length / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.warn("  ! globe assets skipped:", e.message);
}
console.log("Done.");

/* Agri-SHIELD service worker — hand-written, no build step.
 *
 *  Precache      app shell + /offline
 *  Navigations   network-first (4 s timeout) → cached page → /offline
 *  /_next/static cache-first (content-hashed, immutable)
 *  Static/media  stale-while-revalidate
 *  Map tiles     stale-while-revalidate, capped (Esri dark/imagery, NASA GIBS, OSM)
 *  tRPC GET      farmer.* / public.* → network-first, cache fallback ≤ 72 h
 *  tRPC POST     farmer.markAlertActioned / farmer.logFarmerAction → queued in
 *                IndexedDB when offline, replayed on `sync` / `online`
 *  Push          Web Push notifications + click-through
 */
const VERSION = "v3-2026-09";
const SHELL = `agri-shell-${VERSION}`;
const PAGES = `agri-pages-${VERSION}`;
const STATIC = `agri-static-${VERSION}`;
const TILES = `agri-tiles-${VERSION}`;
const DATA = `agri-data-${VERSION}`;
const KEEP = [SHELL, PAGES, STATIC, TILES, DATA];

const SHELL_URLS = ["/offline", "/", "/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png", "/badge-72.png", "/favicon.ico"];
const TILE_HOSTS = ["server.arcgisonline.com", "services.arcgisonline.com", "gibs.earthdata.nasa.gov", "tile.openstreetmap.org"];
const MAX_TILES = 180;
const MAX_PAGES = 30;
const MAX_STATIC = 160;
const MAX_DATA = 120;
const DATA_TTL_MS = 72 * 3600 * 1000;
const QUEUEABLE = ["farmer.markAlertActioned", "farmer.logFarmerAction"];
const SYNC_TAG = "agri-sync-actions";

// ─── Lifecycle ──────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // add one by one so a single failure doesn't abort install
      await Promise.all(SHELL_URLS.map((u) => cache.add(new Request(u, { cache: "reload" })).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("agri-") && !KEEP.includes(n)).map((n) => caches.delete(n)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "REPLAY_QUEUE") event.waitUntil(replayQueue());
  if (msg.type === "CLEAR_USER_CACHE") event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(DATA)]));
  if (msg.type === "QUEUE_SIZE") event.waitUntil(queueCount().then((n) => event.source && event.source.postMessage({ type: "QUEUE_SIZE", count: n })));
});

// ─── Helpers ────────────────────────────────────────────────────────────────
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function put(cacheName, request, response, max) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    if (max) trim(cacheName, max);
  } catch (_) {
    /* quota exceeded — ignore */
  }
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  clients.forEach((c) => c.postMessage(message));
}

// ─── Fetch routing ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // tRPC mutations we can safely queue offline
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname.startsWith("/api/trpc/")) {
    const procs = decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(",");
    if (procs.length && procs.every((p) => QUEUEABLE.includes(p))) {
      event.respondWith(queueableMutation(request, procs));
    }
    return;
  }
  if (request.method !== "GET") return;

  // Navigations
  if (request.mode === "navigate") {
    event.respondWith(navigation(event));
    return;
  }

  // Map tiles (cross-origin, usually opaque)
  if (TILE_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(staleWhileRevalidate(request, TILES, MAX_TILES));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never touch auth, realtime streams, or Next dev internals
  if (url.pathname.startsWith("/api/auth") || url.pathname.startsWith("/api/realtime") || url.pathname.startsWith("/_next/webpack-hmr")) return;

  if (url.pathname.startsWith("/api/trpc/")) {
    const procs = decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(",");
    if (procs.every((p) => p.startsWith("farmer.") || p.startsWith("public."))) {
      event.respondWith(networkFirstData(request));
    }
    return;
  }

  // RSC payloads for client-side navigation: network, fall back to nothing (Next will hard-navigate)
  if (request.headers.get("RSC") === "1") return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC, MAX_STATIC));
    return;
  }

  if (/\.(?:png|jpg|jpeg|webp|avif|svg|ico|woff2?|ttf|css|js|json)$/.test(url.pathname) || url.pathname.startsWith("/_next/image")) {
    event.respondWith(staleWhileRevalidate(request, STATIC, MAX_STATIC));
  }
});

async function navigation(event) {
  const { request } = event;
  try {
    const preload = await event.preloadResponse;
    const response = preload || (await Promise.race([fetch(request), timeout(4000)]));
    if (response && response.ok && response.type === "basic" && !response.redirected) {
      put(PAGES, request, response.clone(), MAX_PAGES);
    }
    return response;
  } catch (_) {
    const cached = (await caches.match(request, { ignoreSearch: true })) || (await caches.match(request));
    if (cached) return cached;
    return (await caches.match("/offline")) || new Response("<h1>Offline</h1><p>Reconnect to load Agri-SHIELD.</p>", { headers: { "Content-Type": "text/html" }, status: 503 });
  }
}

async function cacheFirst(request, cacheName, max) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) put(cacheName, request, response.clone(), max);
  return response;
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) put(cacheName, request, response.clone(), max);
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || new Response("", { status: 504 });
}

async function networkFirstData(request) {
  try {
    const response = await Promise.race([fetch(request), timeout(8000)]);
    if (response.ok) {
      const body = await response.clone().arrayBuffer();
      const headers = new Headers(response.headers);
      headers.set("x-sw-cached-at", String(Date.now()));
      put(DATA, request, new Response(body, { status: response.status, headers }), MAX_DATA);
    }
    return response;
  } catch (_) {
    const cache = await caches.open(DATA);
    const cached = await cache.match(request);
    if (cached) {
      const at = Number(cached.headers.get("x-sw-cached-at") || 0);
      if (Date.now() - at <= DATA_TTL_MS) {
        const headers = new Headers(cached.headers);
        headers.set("x-sw-offline", "1");
        return new Response(await cached.arrayBuffer(), { status: 200, headers });
      }
      cache.delete(request);
    }
    return new Response(JSON.stringify([{ error: { json: { message: "Offline and no cached data (last 72 h)", code: -32000, data: { code: "OFFLINE", httpStatus: 503 } } } }]), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ─── Background sync queue (IndexedDB) ──────────────────────────────────────
const DB_NAME = "agri-shield-sw";
const STORE = "outbox";

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && "result" in result ? result.result : result);
    t.onerror = () => reject(t.error);
  });
}

const queueAdd = (item) => tx("readwrite", (s) => s.add(item));
const queueAll = () => tx("readonly", (s) => s.getAll());
const queueDelete = (id) => tx("readwrite", (s) => s.delete(id));
const queueCount = () => tx("readonly", (s) => s.count()).catch(() => 0);

async function queueableMutation(request, procs) {
  const body = await request.clone().text();
  try {
    const response = await fetch(request);
    // 5xx: server unreachable behind a proxy — queue as well
    if (response.status < 500) return response;
    throw new Error(`HTTP ${response.status}`);
  } catch (_) {
    await queueAdd({ url: request.url, body, contentType: request.headers.get("content-type") || "application/json", procs, queuedAt: Date.now() });
    if (self.registration.sync) await self.registration.sync.register(SYNC_TAG).catch(() => undefined);
    const count = await queueCount();
    broadcast({ type: "ACTION_QUEUED", count });
    // Synthetic tRPC batch response (superjson envelope) so the UI can proceed optimistically
    const payload = procs.map(() => ({ result: { data: { json: { queued: true, offline: true, queuedAt: new Date().toISOString() } } } }));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json", "x-sw-queued": "1" } });
  }
}

let replaying = null;
function replayQueue() {
  if (replaying) return replaying;
  replaying = (async () => {
    const items = await queueAll().catch(() => []);
    let sent = 0;
    for (const item of items) {
      try {
        const res = await fetch(item.url, { method: "POST", body: item.body, headers: { "Content-Type": item.contentType }, credentials: "same-origin" });
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        await queueDelete(item.id); // 2xx and 4xx (e.g. already actioned) both leave the queue
        sent++;
      } catch (_) {
        break; // still offline — stop and retry on next sync
      }
    }
    const remaining = await queueCount();
    if (sent) broadcast({ type: "QUEUE_REPLAYED", sent, remaining });
    if (remaining) throw new Error("queue not empty"); // tells the Sync API to retry later
  })().finally(() => {
    replaying = null;
  });
  return replaying;
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replayQueue());
});

// ─── Web Push ───────────────────────────────────────────────────────────────
const SEVERITY_VIBRATE = { emergency: [400, 120, 400, 120, 400], warning: [250, 100, 250], watch: [150] };

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Agri-SHIELD alert";
  const severity = data.severity || "watch";
  const options = {
    body: data.body || "New flood or salinity guidance for your fields.",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: data.tag || data.alertId || "agri-alert",
    renotify: severity !== "watch",
    requireInteraction: severity === "emergency",
    vibrate: SEVERITY_VIBRATE[severity] || [150],
    timestamp: Date.now(),
    data: { url: data.url || "/dashboard/farmer/alerts", alertId: data.alertId || null },
    actions: [
      { action: "open", title: "View guidance" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard/farmer", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          await c.focus();
          if ("navigate" in c) return c.navigate(target);
          return;
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // Let an open page re-subscribe with the server's VAPID key.
  event.waitUntil(broadcast({ type: "PUSH_RESUBSCRIBE" }));
});

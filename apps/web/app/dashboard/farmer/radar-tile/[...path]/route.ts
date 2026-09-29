/**
 * Same-origin proxy for RainViewer radar tiles.
 *
 * The app's CSP (next.config.ts, img-src allow-list) does not include
 * tilecache.rainviewer.com, so the farmer radar loads tiles through here.
 * Only the exact RainViewer tile path shape is accepted (no open proxy / SSRF):
 *   /dashboard/farmer/radar-tile/v2/radar/<hex id>/256/<z>/<x>/<y>/2/1_1.png
 * Protected by the /dashboard/farmer middleware (signed-in farm users only).
 */
const PATH = /^v2\/radar\/[0-9a-f]{6,20}\/256\/\d{1,2}\/\d{1,6}\/\d{1,6}\/2\/1_1\.png$/;

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const p = path.join("/");
  if (!PATH.test(p)) return new Response("bad tile path", { status: 400 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://tilecache.rainviewer.com/${p}`, { signal: ctrl.signal, headers: { "User-Agent": "Agri-SHIELD/1.0 (farm radar)" } });
    if (!r.ok) return new Response(null, { status: r.status === 404 ? 404 : 502 });
    return new Response(await r.arrayBuffer(), { headers: { "content-type": "image/png", "cache-control": "public, max-age=600" } });
  } catch {
    return new Response(null, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}

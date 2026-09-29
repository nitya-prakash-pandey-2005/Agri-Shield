/** GET /api/v1/openapi.json — OpenAPI 3.1 description of the public REST API. */
import { openApiDocument } from "@/server/api/openapi";
import { json } from "@/server/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const u = new URL(req.url);
  return json(openApiDocument(`${u.protocol}//${u.host}`), { headers: { "Cache-Control": "public, max-age=3600" } });
}

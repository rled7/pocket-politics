/**
 * TypeScript API server — the TS contender in the bake-off, as a standalone HTTP server so it
 * can be benchmarked head-to-head with the Rust `pp-server` on the same host. It reuses the
 * EXACT shared data layer (handlers.ts) and caching helpers (http.ts) that the Cloudflare
 * Functions use, so it's faithful to the deployed behavior — just wrapped in node:http instead
 * of Pages Functions.
 *
 *   PORT=8788 npx tsx src/api_server.ts        # fixtures, or set CONGRESS_API_KEY for live
 */
import http from "node:http";
import { getMembers, getBills, getProfile, clampLimit, isBioguide, DEFAULT_BIOGUIDE } from "./handlers.ts";
import { jsonCached, jsonImmutable, jsonPointer, jsonError } from "./http.ts";
import { dataVersion } from "./version.ts";

const KEY = process.env.CONGRESS_API_KEY || undefined;
const PORT = Number(process.env.PORT ?? 8788);

async function route(url: URL, request: Request): Promise<Response> {
  const segs = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const q = url.searchParams;

  // mutable
  if (segs[0] === "api" && segs[1] === "latest") return jsonPointer({ dataVersion: dataVersion() });
  if (segs[0] === "api" && segs[1] === "members") {
    return jsonCached(await getMembers(clampLimit(q.get("limit"), 250, 250), KEY), { request });
  }
  if (segs[0] === "api" && segs[1] === "bills") {
    return jsonCached(await getBills(clampLimit(q.get("limit"), 20, 50), KEY), { request });
  }
  if (segs[0] === "api" && segs[1] === "profile") {
    const b = (q.get("bioguide") || DEFAULT_BIOGUIDE).toUpperCase();
    if (!isBioguide(b)) return jsonError("Invalid bioguide id (expected e.g. O000172)", 400);
    return jsonCached(await getProfile(b, KEY), { request });
  }
  // immutable, version-addressed: /api/v/{ver}/...
  if (segs[0] === "api" && segs[1] === "v") {
    if (segs[3] === "members") return jsonImmutable(await getMembers(250, KEY), { request });
    if (segs[3] === "bills") return jsonImmutable(await getBills(50, KEY), { request });
    if (segs[3] === "profile" && segs[4]) {
      const b = segs[4].toUpperCase();
      if (!isBioguide(b)) return jsonError("Invalid bioguide id (expected e.g. O000172)", 400);
      return jsonImmutable(await getProfile(b, KEY), { request });
    }
  }
  if (segs[0] === "healthz") return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  return jsonError("not found", 404);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const inm = req.headers["if-none-match"];
    const request = new Request("http://x" + url.pathname + url.search,
      { headers: inm ? { "If-None-Match": String(inm) } : {} });
    const out = await route(url, request);
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(await out.text());
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "internal" }));
  }
});

server.listen(PORT, () => console.log(`pp api-server (TypeScript) listening on :${PORT}`));

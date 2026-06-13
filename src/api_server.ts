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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { getMembers, getBills, getProfile, getBillVotes, clampLimit, isBioguide, DEFAULT_BIOGUIDE } from "./handlers.ts";
import { jsonCached, jsonImmutable, jsonPointer, jsonError } from "./http.ts";
import { dataVersion } from "./version.ts";

const KEY = process.env.CONGRESS_API_KEY || undefined;
const PORT = Number(process.env.PORT ?? 8788);

// In-memory response cache (the L-1 tier the persistent server unlocks — serverless can't).
// First request hits Congress.gov; subsequent ones within the TTL serve from memory instantly.
type Cached = { exp: number; status: number; headers: [string, string][]; body: string };
const apiCache = new Map<string, Cached>();
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

// Serve the static web client (so this one server = the whole app locally, like Pages does).
async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "/explore.html" : pathname; // land on the directory
  const full = normalize(join(WEB, rel));
  if (!full.startsWith(WEB)) { res.statusCode = 403; res.end("forbidden"); return; }
  try {
    const body = await readFile(full);
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[extname(full)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404; res.setHeader("Content-Type", "text/plain"); res.end("Not found");
  }
}

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
  if (segs[0] === "api" && segs[1] === "votes") {
    const congress = parseInt(q.get("congress") ?? "118", 10) || 118;
    return jsonCached(await getBillVotes(congress, q.get("type") ?? "hr", q.get("number") ?? "1", KEY), { request });
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
    // Static web client for everything that isn't the API.
    if (!url.pathname.startsWith("/api") && url.pathname !== "/healthz") {
      return await serveStatic(url.pathname, res);
    }
    const ckey = url.pathname + url.search;
    const now = Date.now();
    const hit = apiCache.get(ckey);
    if (hit && hit.exp > now) {
      res.statusCode = hit.status;
      for (const [k, v] of hit.headers) res.setHeader(k, v);
      res.setHeader("X-Cache", "HIT");
      res.end(hit.body);
      return;
    }

    const inm = req.headers["if-none-match"];
    const request = new Request("http://x" + url.pathname + url.search,
      { headers: inm ? { "If-None-Match": String(inm) } : {} });
    const out = await route(url, request);
    const body = await out.text();
    res.statusCode = out.status;
    const hdrs: [string, string][] = [];
    out.headers.forEach((v, k) => { res.setHeader(k, v); hdrs.push([k, v]); });

    // Cache successful, publicly-cacheable responses in memory for their TTL.
    const cc = out.headers.get("Cache-Control") ?? "";
    if (out.status === 200 && cc.includes("public")) {
      const m = cc.match(/s-maxage=(\d+)/) ?? cc.match(/max-age=(\d+)/);
      const ttl = m ? parseInt(m[1], 10) : 300;
      apiCache.set(ckey, { exp: now + ttl * 1000, status: 200, headers: hdrs, body });
    }
    res.setHeader("X-Cache", "MISS");
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "internal" }));
  }
});

server.listen(PORT, () => console.log(`pp api-server (TypeScript) listening on :${PORT}`));

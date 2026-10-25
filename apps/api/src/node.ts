/**
 * Node entry — the persistent-server host for the ONE Hono app (`app.ts`). It is the TS contender
 * in the bake-off (benchmarked head-to-head with the Rust `pp-server` on the same host) and the
 * "any container" deploy target; `worker.ts` is the Cloudflare Workers entry for the same app.
 *
 * What lives HERE and nowhere else (decoupling rule 1): `process.env`, `node:http`, `node:fs` static
 * file serving from apps/web, the in-memory SWR cache (L1) with prewarm + background refresh, the
 * single MemoryStore, and the client-IP logic. Routing, validation and responses are the shared app.
 *
 *   PORT=8788 npx tsx src/node.ts        # fixtures, or set CONGRESS_API_KEY for live
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { createApp, isApiPath } from "./app.ts";
import { loadConfig, keySummary } from "./config.ts";
import { MemoryStore } from "./store.ts";
import { rateLimit } from "./ratelimit.ts";
import { SwrCache, mapLimit, type LoadResult } from "./swr_cache.ts";
import { SECURITY_HEADERS } from "./security_headers.ts";

const config = loadConfig(process.env);
const PORT = Number(process.env.PORT ?? 8788);
const store = new MemoryStore(); // single shared store for the process (comments persist while up)

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); req.on("error", () => resolve(""));
  });
}

function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  return (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

// The app asks "who is calling?" with only the Web Request in hand, so remember each forwarded
// request's address here (a WeakMap, not a header: a client can't spoof it).
const callers = new WeakMap<Request, string>();

const app = createApp({
  config,
  store,
  rateLimit,
  clientIp: (request) => callers.get(request) ?? "unknown",
});

/** Public origin for the Web Request URL — the app reads it for Stripe's success/cancel URLs. */
function originOf(req: http.IncomingMessage): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host || `localhost:${PORT}`;
  try { return new URL(`${proto}://${host}`).origin; } catch { return `http://localhost:${PORT}`; }
}

/** Node request → Web Request for the app. Anything that isn't a POST is a GET, as the old router had it. */
function toWebRequest(req: http.IncomingMessage, url: URL, body?: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k === "host" || k === "connection" || k === "content-length" || k === "transfer-encoding") continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const request = new Request(originOf(req) + url.pathname + url.search, {
    method: body === undefined ? "GET" : "POST", headers, body,
  });
  callers.set(request, clientIp(req));
  return request;
}

/** Web Response → Node response (status, every header, body). */
async function sendWeb(res: http.ServerResponse, out: Response, xCache?: string): Promise<void> {
  const body = await out.text(); // 304 → ""
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  if (xCache) res.setHeader("X-Cache", xCache);
  res.end(body);
}

// In-memory stale-while-revalidate cache (the L1 tier the persistent server unlocks — serverless
// can't). Cold first request hits Congress.gov; after that EVERY request serves from memory at
// ~1ms (fresh → HIT, expired → STALE + background refresh). warm()/backgroundFill() below
// pre-populate it so even first navigation is instant. See swr_cache.ts + CACHING_ARCHITECTURE.md.
const apiCache = new SwrCache();

/** Loader for a cache key (pathname+search): run the app, return the cacheable response + TTL. */
async function runRoute(ckey: string): Promise<LoadResult> {
  const out = await app.fetch(new Request("http://x" + ckey));
  const body = await out.text();
  const headers: [string, string][] = [];
  out.headers.forEach((v, k) => headers.push([k, v]));
  const cc = out.headers.get("Cache-Control") ?? "";
  if (out.status === 200 && cc.includes("public")) {
    const m = cc.match(/s-maxage=(\d+)/) ?? cc.match(/max-age=(\d+)/);
    const ttlMs = (m ? parseInt(m[1], 10) : 300) * 1000;
    return { resp: { status: 200, headers, body, etag: out.headers.get("ETag") ?? undefined }, ttlMs };
  }
  return null; // not publicly cacheable (errors, no-store) → caller serves it live, uncached
}
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web"); // apps/web
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

// Serve the static web client (so this one server = the whole app locally, like the Workers assets do).
async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "/home.html" : pathname; // land on the personalized home
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

function setSecurityHeaders(res: http.ServerResponse): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url ?? "/", "http://localhost");
    // Static web client for everything that isn't the API.
    if (!isApiPath(url.pathname)) {
      return await serveStatic(url.pathname, res);
    }

    // Writes (comments, reactions, track, translate, checkout) are never cached: straight to the app.
    // Comments and reactions answer GET too; the other three only POST (anything else falls through
    // to the cache path below, where the app returns its JSON 404).
    const post = req.method === "POST";
    if (url.pathname === "/api/comments" || url.pathname === "/api/reactions" ||
        (post && (url.pathname === "/api/track" || url.pathname === "/api/translate" || url.pathname === "/api/checkout"))) {
      const body = post ? (await readBody(req)) : undefined;
      return await sendWeb(res, await app.fetch(toWebRequest(req, url, body)));
    }

    const ckey = url.pathname + url.search;
    const inm = req.headers["if-none-match"] ? String(req.headers["if-none-match"]) : undefined;

    // Serve any entry we already have INSTANTLY (fresh or stale). A stale entry is served
    // immediately and refreshed in the background — the reader never waits on a refetch.
    const peek = apiCache.peek(ckey);
    if (peek) {
      if (!peek.fresh) apiCache.revalidate(ckey, () => runRoute(ckey)); // background, single-flight
      const e = peek.entry;
      if (inm && e.etag && inm === e.etag) { // client already has this version
        res.statusCode = 304;
        for (const [k, v] of e.headers) if (k.toLowerCase() === "cache-control" || k.toLowerCase() === "etag") res.setHeader(k, v);
        res.setHeader("X-Cache", peek.fresh ? "HIT" : "STALE");
        res.end();
        return;
      }
      res.statusCode = e.status;
      for (const [k, v] of e.headers) res.setHeader(k, v);
      res.setHeader("X-Cache", peek.fresh ? "HIT" : "STALE");
      res.end(e.body);
      return;
    }

    // Cold miss — the only blocking path. Load once (single-flight) and cache if cacheable.
    const entry = await apiCache.load(ckey, () => runRoute(ckey));
    if (entry) {
      res.statusCode = entry.status;
      for (const [k, v] of entry.headers) res.setHeader(k, v);
      res.setHeader("X-Cache", "MISS");
      res.end(entry.body);
      return;
    }

    // Not publicly cacheable (errors / no-store) — serve live, honoring If-None-Match.
    const out = await app.fetch(new Request("http://x" + ckey, { headers: inm ? { "If-None-Match": inm } : {} }));
    return await sendWeb(res, out, "BYPASS");
  } catch (err) {
    // Last-resort guard (the app handles its own errors → generic 500): log, never echo details.
    console.error("[500]", req.method, req.url, err instanceof Error ? err.stack || err.message : err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`pp api-server (TypeScript) listening on :${PORT}`);
  console.log(`  integrations: ${keySummary(config)}`); // secrets-safe: shows ✓/✗ per key, never the value
});

// ── Make it feel static: warm the cache so navigation is instant from the first click ─────────
// 1) Warm the common entry points NOW (directory + bills) so the landing pages are instant.
// 2) Then background-fill every member profile (bounded concurrency) so the long tail — the
//    slowest path (profile ≈ 2s cold) — becomes instant within a couple minutes, no one waiting.
// 3) A refresh loop re-pulls cached keys before they go stale, so data stays fresh (~daily-changing
//    congressional data; a few-minute freshness window is invisible). Disable with PREWARM=0.
const PREWARM = process.env.PREWARM !== "0";
const COMMON_KEYS = ["/api/members?limit=540", "/api/bills?limit=50", "/api/bills?limit=50&sponsors=1", "/api/latest", "/api/committees"];

async function warm(): Promise<void> {
  if (!PREWARM) return;
  const t0 = Date.now();
  await Promise.all(COMMON_KEYS.map((k) => apiCache.load(k, () => runRoute(k))));
  console.log(`  cache warm: entry points ready (${apiCache.size()} keys, ${Date.now() - t0}ms)`);

  // Background-fill all profiles — slowest cold path → instant once filled.
  const peek = apiCache.peek("/api/members?limit=540");
  if (!peek) return;
  let ids: string[] = [];
  try { ids = (JSON.parse(peek.entry.body).members ?? []).map((m: { bioguideId: string }) => m.bioguideId).filter(Boolean); }
  catch { /* leave empty */ }
  if (!ids.length) return;
  const t1 = Date.now();
  await mapLimit(ids, 6, async (id) => {
    const k = `/api/profile?bioguide=${id}`;
    await apiCache.load(k, () => runRoute(k));
  });
  console.log(`  cache warm: ${ids.length} profiles filled in ${Math.round((Date.now() - t1) / 1000)}s — every page now sub-ms`);
}

// Keep the HOT ENTRY POINTS fresh on a timer — an explicit ALLOWLIST, never "every cached key".
// Why an allowlist (fail-safe): each upstream has a quota — Congress.gov 5,000/hr, FEC 1,000/hr,
// OpenStates **500/DAY**, NY OpenLeg/LDA modest. Looping over apiCache.keys() and re-pulling all of
// them re-hit those quotas hard: ~540 prewarmed profiles × 2 Congress.gov calls × 15 cycles/hr ≈ 16k/hr
// (3× the limit), and a few cached city lookups (OpenStates) would exhaust the daily 500 by lunch.
// So we proactively refresh ONLY keys backed by generous / no-key upstreams (Congress.gov + senate.gov).
// EVERYTHING ELSE — profiles, money(FEC), local officials(OpenStates), ny(OpenLeg), lobbying(LDA) —
// rides on-access SWR: refreshed only when a real reader views it, single-flighted, so traffic-bounded.
// A new endpoint added later is quota-safe BY DEFAULT (it just isn't on this list). isStale() skips
// keys still inside their freshness window so we never spend an upstream call on a no-op.
const REFRESH_ALLOWLIST = [
  ...COMMON_KEYS,                 // Congress.gov: members directory + bills feeds (5,000/hr — generous)
  "/api/budget", "/api/record",  // Congress.gov singletons
  "/api/cloture",                // senate.gov roll-call XML — no key, no quota
];
function startRefreshLoop(): void {
  if (!PREWARM) return;
  setInterval(() => {
    for (const k of REFRESH_ALLOWLIST) {
      if (apiCache.isStale(k)) apiCache.revalidate(k, () => runRoute(k));
    }
  }, 240_000).unref(); // every 4 min; unref so it never holds the process open
}

void warm().then(startRefreshLoop).catch((e) => console.warn("prewarm error:", e));

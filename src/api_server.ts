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
import { getMembers, getBills, getBillsWithSponsors, getBill, getProfile, getBillVotes, getReps, getRepsByCoords, clampLimit, isBioguide, DEFAULT_BIOGUIDE } from "./handlers.ts";
import { getMoney } from "./money.ts";
import { jsonCached, jsonImmutable, jsonPointer, jsonError } from "./http.ts";
import { dataVersion } from "./version.ts";
import { MemoryStore } from "./store.ts";
import { getComments, addComment, validBillId } from "./comments.ts";
import { getReactions, setReaction, isReaction, validClientId } from "./reactions.ts";
import { getLobbying } from "./lobbying.ts";
import { buildInfo } from "./build.ts";
import { SwrCache, mapLimit, type LoadResult } from "./swr_cache.ts";
import { KEYS, integrations, keySummary } from "./config.ts";

const KEY = KEYS.congress;
const FEC_KEY = KEYS.fec;
const PORT = Number(process.env.PORT ?? 8788);
const store = new MemoryStore(); // single shared store for the process (comments persist while up)

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); req.on("error", () => resolve(""));
  });
}
function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// In-memory stale-while-revalidate cache (the L1 tier the persistent server unlocks — serverless
// can't). Cold first request hits Congress.gov; after that EVERY request serves from memory at
// ~1ms (fresh → HIT, expired → STALE + background refresh). warm()/backgroundFill() below
// pre-populate it so even first navigation is instant. See swr_cache.ts + CACHING_ARCHITECTURE.md.
const apiCache = new SwrCache();

/** Loader for a cache key (pathname+search): run the route, return the cacheable response + TTL. */
async function runRoute(ckey: string): Promise<LoadResult> {
  const url = new URL("http://localhost" + ckey);
  const out = await route(url, new Request("http://x" + ckey));
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
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

// Serve the static web client (so this one server = the whole app locally, like Pages does).
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

async function route(url: URL, request: Request): Promise<Response> {
  const segs = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const q = url.searchParams;

  // mutable
  if (segs[0] === "api" && segs[1] === "latest") return jsonPointer({ dataVersion: dataVersion() });
  // Which data integrations are configured (booleans only — never exposes key values).
  if (segs[0] === "api" && segs[1] === "integrations") return jsonCached({ integrations: integrations() }, { request });
  // Build / release version (human-facing app version + build number + data version).
  if (segs[0] === "api" && segs[1] === "version") return jsonCached({ ...buildInfo(), dataVersion: dataVersion() }, { request });
  if (segs[0] === "api" && segs[1] === "members") {
    return jsonCached(await getMembers(clampLimit(q.get("limit"), 540, 540), KEY), { request });
  }
  if (segs[0] === "api" && segs[1] === "bills") {
    const lim = clampLimit(q.get("limit"), 20, 50);
    if (q.get("sponsors")) return jsonCached(await getBillsWithSponsors(lim, KEY), { request });
    return jsonCached(await getBills(lim, KEY), { request });
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
  if (segs[0] === "api" && segs[1] === "bill") {
    const congress = parseInt(q.get("congress") ?? "118", 10) || 118;
    return jsonCached(await getBill(congress, q.get("type") ?? "hr", q.get("number") ?? "1", KEY), { request });
  }
  if (segs[0] === "api" && segs[1] === "lobbying") {
    const yr = parseInt(q.get("year") ?? "", 10);
    const year = Number.isFinite(yr) ? yr : new Date().getFullYear();
    return jsonCached(await getLobbying((q.get("q") ?? "").slice(0, 120), KEYS.lda, year), { request });
  }
  if (segs[0] === "api" && segs[1] === "money") {
    const b = (q.get("bioguide") || DEFAULT_BIOGUIDE).toUpperCase();
    if (!isBioguide(b)) return jsonError("Invalid bioguide id (expected e.g. O000172)", 400);
    return jsonCached(await getMoney(b, FEC_KEY), { request });
  }
  if (segs[0] === "api" && segs[1] === "reps") {
    const lat = parseFloat(q.get("lat") ?? ""), lon = parseFloat(q.get("lon") ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lon)) return jsonCached(await getRepsByCoords(lat, lon, KEY), { request });
    const addr = (q.get("address") ?? "").trim();
    if (!addr) return jsonError("address or lat/lon required", 400);
    return jsonCached(await getReps(addr, KEY), { request });
  }
  // immutable, version-addressed: /api/v/{ver}/...
  if (segs[0] === "api" && segs[1] === "v") {
    if (segs[3] === "members") return jsonImmutable(await getMembers(540, KEY), { request });
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

    // Bill comments — read + write, never cached.
    if (url.pathname === "/api/comments") {
      if (req.method === "POST") {
        const payload = JSON.parse((await readBody(req)) || "{}");
        const bill = String(payload.bill ?? "");
        if (!validBillId(bill)) return sendJson(res, 400, { error: "invalid bill id" });
        try {
          const comments = await addComment(store, bill, {
            author: payload.author, district: payload.district, email: payload.email, text: payload.text,
          });
          return sendJson(res, 200, { comments });
        } catch (e) { return sendJson(res, 400, { error: e instanceof Error ? e.message : "bad request" }); }
      }
      const bill = url.searchParams.get("bill") ?? "";
      if (!validBillId(bill)) return sendJson(res, 400, { error: "invalid bill id" });
      return sendJson(res, 200, { comments: await getComments(store, bill) });
    }

    // Bill reactions (like / dislike / neutral) — read + write, never cached.
    if (url.pathname === "/api/reactions") {
      if (req.method === "POST") {
        const payload = JSON.parse((await readBody(req)) || "{}");
        const bill = String(payload.bill ?? "");
        const client = String(payload.client ?? "");
        const reaction = String(payload.reaction ?? "");
        if (!validBillId(bill)) return sendJson(res, 400, { error: "invalid bill id" });
        if (!validClientId(client)) return sendJson(res, 400, { error: "invalid client id" });
        if (!isReaction(reaction)) return sendJson(res, 400, { error: "reaction must be like, dislike, or neutral" });
        return sendJson(res, 200, await setReaction(store, bill, client, reaction));
      }
      const client = url.searchParams.get("client") ?? undefined;
      const bills = url.searchParams.get("bills"); // batch: load a whole feed in one request
      if (bills) {
        const ids = bills.split(",").filter(validBillId).slice(0, 100);
        const reactions: Record<string, unknown> = {};
        for (const id of ids) reactions[id] = await getReactions(store, id, client);
        return sendJson(res, 200, { reactions });
      }
      const bill = url.searchParams.get("bill") ?? "";
      if (!validBillId(bill)) return sendJson(res, 400, { error: "invalid bill id" });
      return sendJson(res, 200, await getReactions(store, bill, client));
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
    const out = await route(url, new Request("http://x" + ckey, { headers: inm ? { "If-None-Match": inm } : {} }));
    const body = await out.text();
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("X-Cache", "BYPASS");
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "internal" }));
  }
});

server.listen(PORT, () => {
  console.log(`pp api-server (TypeScript) listening on :${PORT}`);
  console.log(`  integrations: ${keySummary()}`); // secrets-safe: shows ✓/✗ per key, never the value
});

// ── Make it feel static: warm the cache so navigation is instant from the first click ─────────
// 1) Warm the common entry points NOW (directory + bills) so the landing pages are instant.
// 2) Then background-fill every member profile (bounded concurrency) so the long tail — the
//    slowest path (profile ≈ 2s cold) — becomes instant within a couple minutes, no one waiting.
// 3) A refresh loop re-pulls cached keys before they go stale, so data stays fresh (~daily-changing
//    congressional data; a few-minute freshness window is invisible). Disable with PREWARM=0.
const PREWARM = process.env.PREWARM !== "0";
const COMMON_KEYS = ["/api/members?limit=540", "/api/bills?limit=50", "/api/bills?limit=50&sponsors=1", "/api/latest"];

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

// Keep warm entries fresh: re-pull each cached key on an interval shorter than its TTL.
function startRefreshLoop(): void {
  if (!PREWARM) return;
  setInterval(() => {
    for (const k of apiCache.keys()) apiCache.revalidate(k, () => runRoute(k));
  }, 240_000).unref(); // every 4 min; unref so it never holds the process open
}

void warm().then(startRefreshLoop).catch((e) => console.warn("prewarm error:", e));

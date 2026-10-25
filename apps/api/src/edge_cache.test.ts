/**
 * Tests for the Workers-host helpers that don't need a Workers runtime: the edge response cache
 * (edge_cache.ts, driven here by a Map-backed fake of the Cache API) and the profile-view
 * instrumentation (views.ts). No test framework — runs under `tsx`, asserts, exits non-zero on failure.
 *
 * The behaviors that matter: a repeat GET is served from the cache WITHOUT running the app (so the
 * government APIs behind it are only hit on misses), and nothing personal / non-GET / error is ever stored.
 */
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { MemoryStore, type Store } from "./store.ts";
import { rateLimit } from "./ratelimit.ts";
import { withEdgeCache, isEdgeCacheableRequest, isEdgeCacheableResponse, type CacheLike } from "./edge_cache.ts";
import { profileViewKey, recordProfileView } from "./views.ts";
import { SECURITY_HEADERS } from "./security_headers.ts";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name}`); }
}
const section = (s: string) => console.log(`\n${s}`);

/** A Map-backed stand-in for `caches.default`: keyed by URL, hands back a fresh Response per match (like the real one). */
class FakeCache implements CacheLike {
  entries = new Map<string, { status: number; headers: [string, string][]; body: string }>();
  puts: string[] = [];
  matches: string[] = [];
  async match(request: Request): Promise<Response | undefined> {
    this.matches.push(request.method + " " + request.url);
    const e = this.entries.get(request.url);
    return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
  }
  async put(request: Request, response: Response): Promise<void> {
    if (request.method !== "GET") throw new TypeError("Cache.put only accepts GET (like the real Cache API)");
    this.puts.push(request.url);
    const headers: [string, string][] = [];
    response.headers.forEach((v, k) => headers.push([k, v]));
    this.entries.set(request.url, { status: response.status, headers, body: await response.text() });
  }
}

/** One simulated Worker invocation: waitUntil promises are collected and awaited, like the runtime does after the response. */
function harness(cache: CacheLike, runApp: (req: Request) => Promise<Response>) {
  const calls: Request[] = [];
  async function fetch(url: string, init?: RequestInit): Promise<Response> {
    const pending: Promise<unknown>[] = [];
    const res = await withEdgeCache(new Request(url, init), async (req) => { calls.push(req); return runApp(req); }, {
      cache, waitUntil: (p) => pending.push(p),
    });
    await Promise.all(pending); // let the background cache.put finish
    return res;
  }
  return { fetch, calls };
}

const app = createApp({
  config: loadConfig({}),
  store: new MemoryStore(),
  rateLimit,
  clientIp: () => "edge-cache-test",
});
const runReal = (req: Request) => Promise.resolve(app.fetch(req));
const U = "https://pocketpolitics.example";

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Which requests / responses may be cached");
{
  const req = (path: string, method = "GET") => new Request(U + path, { method });
  check("GET /api/members is cacheable", isEdgeCacheableRequest(req("/api/members?limit=5")));
  check("GET /api/v/{ver}/members and /api/latest are cacheable", isEdgeCacheableRequest(req("/api/v/abc/members")) && isEdgeCacheableRequest(req("/api/latest")));
  check("POST (even to a cacheable path) is not", !isEdgeCacheableRequest(req("/api/members", "POST")) && !isEdgeCacheableRequest(req("/api/track", "POST")));
  check("HEAD / PUT / DELETE are not", !isEdgeCacheableRequest(req("/api/members", "HEAD")) && !isEdgeCacheableRequest(req("/api/members", "PUT")) && !isEdgeCacheableRequest(req("/api/members", "DELETE")));
  check("/api/comments is never cached (per-bill user content)", !isEdgeCacheableRequest(req("/api/comments?bill=118-hr-1")));
  check("/api/reactions is never cached (per-client)", !isEdgeCacheableRequest(req("/api/reactions?bill=118-hr-1&client=c-0000-0001")));
  check("/api/reps is never cached (address / location in the URL)", !isEdgeCacheableRequest(req("/api/reps?address=1+Main+St")) && !isEdgeCacheableRequest(req("/api/reps?lat=40.7&lon=-74")));
  check("trailing slashes don't sneak past the exclusions", !isEdgeCacheableRequest(req("/api/reps/?address=x")) && !isEdgeCacheableRequest(req("/api/comments/")));
  check("non-API paths (/healthz, pages) are not", !isEdgeCacheableRequest(req("/healthz")) && !isEdgeCacheableRequest(req("/home.html")));

  const res = (status: number, cc: string | null) => new Response("{}", { status, headers: cc === null ? {} : { "Cache-Control": cc } });
  const PUB = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400";
  check("200 + public Cache-Control is cacheable", isEdgeCacheableResponse(res(200, PUB)) && isEdgeCacheableResponse(res(200, "public, max-age=31536000, immutable")));
  check("no-store is not", !isEdgeCacheableResponse(res(200, "no-store")));
  check("private is not", !isEdgeCacheableResponse(res(200, "private, max-age=60")));
  check("200 with no Cache-Control is not", !isEdgeCacheableResponse(res(200, null)));
  check("non-200 is not (400, 404, 500, 502, 304)", [400, 404, 500, 502].every((s) => !isEdgeCacheableResponse(res(s, PUB))) && !isEdgeCacheableResponse(new Response(null, { status: 304, headers: { "Cache-Control": PUB } })));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("A repeat GET is served from the cache without running the app");
{
  const cache = new FakeCache();
  const h = harness(cache, runReal);

  const first = await h.fetch(U + "/api/members?limit=5");
  const firstBody = await first.text();
  check("first GET runs the app once and is a MISS", h.calls.length === 1 && first.status === 200 && first.headers.get("X-Cache") === "MISS");
  check("…and stores exactly one entry, under the URL", cache.puts.length === 1 && cache.puts[0] === U + "/api/members?limit=5");

  const second = await h.fetch(U + "/api/members?limit=5");
  const secondBody = await second.text();
  check("second GET does NOT run the app (app calls still 1) → HIT", h.calls.length === 1 && second.headers.get("X-Cache") === "HIT");
  check("…same status and body as the original", second.status === 200 && secondBody === firstBody && secondBody.includes('"members"'));
  check("…Cache-Control, ETag, Content-Type and security headers survive the cache",
    second.headers.get("Cache-Control") === first.headers.get("Cache-Control") && second.headers.get("ETag") === first.headers.get("ETag") &&
    second.headers.get("Content-Type") === "application/json" && Object.entries(SECURITY_HEADERS).every(([k, v]) => second.headers.get(k) === v));
  check("…and a HIT is not written back (still one put)", cache.puts.length === 1);

  await h.fetch(U + "/api/members?limit=5");
  await h.fetch(U + "/api/members?limit=5");
  check("three more repeats → still exactly one app call in total", h.calls.length === 1);

  await h.fetch(U + "/api/members?limit=6");
  check("a different query string is a different entry (MISS → app runs again)", h.calls.length === 2 && cache.puts.length === 2);

  const withHeaders = await h.fetch(U + "/api/members?limit=5", { headers: { "Accept-Encoding": "br", "Accept-Language": "es", Cookie: "a=b" } });
  check("request headers don't fragment the cache (still a HIT)", withHeaders.headers.get("X-Cache") === "HIT" && h.calls.length === 2);

  const imm = await h.fetch(U + "/api/v/abc/profile/O000172");
  const imm2 = await h.fetch(U + "/api/v/abc/profile/O000172");
  check("immutable /api/v/... responses are cached too", imm.headers.get("X-Cache") === "MISS" && imm2.headers.get("X-Cache") === "HIT" && h.calls.length === 3);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Never stored");
{
  const cache = new FakeCache();
  const h = harness(cache, runReal);
  const hits = async (path: string, init?: RequestInit) => { const r = await h.fetch(U + path, init); await r.text(); return r; };

  // POST to a normally-cacheable route: runs the app, bypasses the cache, stores nothing.
  const p1 = await hits("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("POST is never stored and never looked up", p1.headers.get("X-Cache") === "BYPASS" && cache.puts.length === 0 && cache.matches.length === 0);
  await hits("/api/track", { method: "POST", body: JSON.stringify({ kind: "bill", id: "x1" }) });
  await hits("/api/track", { method: "POST", body: JSON.stringify({ kind: "bill", id: "x1" }) });
  check("repeated POSTs both run the app", h.calls.length === 3);

  // The excluded GET routes: run every time, stored never.
  const before = h.calls.length;
  for (const path of ["/api/reps?address=1+Centre+St", "/api/reps?lat=40.71&lon=-74.0", "/api/comments?bill=118-hr-1", "/api/reactions?bill=118-hr-1&client=c-aaaa-0001"]) {
    await hits(path); await hits(path);
  }
  check("/api/reps, /api/comments, /api/reactions: 8 requests → 8 app runs, 0 cache writes, 0 lookups",
    h.calls.length - before === 8 && cache.puts.length === 0 && cache.matches.length === 0);

  // Responses that must not be stored even for a cacheable route.
  const err400 = await hits("/api/profile?bioguide=bad!");
  await hits("/api/profile?bioguide=bad!");
  check("a 400 (no-store) is never stored — repeated requests re-run the app", err400.status === 400 && cache.puts.length === 0);
  const nf = await hits("/api/does-not-exist");
  check("a 404 is never stored", nf.status === 404 && cache.puts.length === 0 && nf.headers.get("X-Cache") === "BYPASS");

  const mk = (res: () => Response) => harness(new FakeCache(), async () => res());
  const noStore = mk(() => new Response("{}", { status: 200, headers: { "Cache-Control": "no-store" } }));
  await noStore.fetch(U + "/api/members"); await noStore.fetch(U + "/api/members");
  check("a 200 marked no-store is never stored", noStore.calls.length === 2);
  const s500 = mk(() => new Response('{"error":"internal server error"}', { status: 500, headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }));
  await s500.fetch(U + "/api/members"); await s500.fetch(U + "/api/members");
  check("a 500 is never stored, even if it claims to be public", s500.calls.length === 2);
  const s502 = mk(() => new Response("{}", { status: 502, headers: { "Cache-Control": "public, s-maxage=300" } }));
  await s502.fetch(U + "/api/bills"); await s502.fetch(U + "/api/bills");
  check("a 502 is never stored", s502.calls.length === 2);
  const noCc = mk(() => new Response("{}", { status: 200 }));
  await noCc.fetch(U + "/api/budget"); await noCc.fetch(U + "/api/budget");
  check("a 200 with no Cache-Control is never stored", noCc.calls.length === 2);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Conditional requests (If-None-Match)");
{
  const cache = new FakeCache();
  const h = harness(cache, runReal);
  const url = U + "/api/members?limit=4";
  const filled = await h.fetch(url);
  const etag = filled.headers.get("ETag")!;
  await filled.text();

  const same = await h.fetch(url, { headers: { "If-None-Match": etag } });
  check("HIT + matching If-None-Match → bodiless 304 with ETag + Cache-Control, app not run",
    same.status === 304 && (await same.text()) === "" && same.headers.get("ETag") === etag && (same.headers.get("Cache-Control") ?? "").includes("s-maxage") && h.calls.length === 1 && same.headers.get("X-Cache") === "HIT");
  check("…the 304 keeps the security headers and drops Content-Type", Object.entries(SECURITY_HEADERS).every(([k, v]) => same.headers.get(k) === v) && !same.headers.has("Content-Type"));
  const stale = await h.fetch(url, { headers: { "If-None-Match": 'W/"old"' } });
  check("HIT + non-matching If-None-Match → full 200", stale.status === 200 && (await stale.text()).includes('"members"') && h.calls.length === 1);

  // A cold cache + a revalidating browser must still FILL the cache (else every browser revalidation would hit the origin).
  const cold = new FakeCache();
  const hc = harness(cold, runReal);
  const first = await hc.fetch(url, { headers: { "If-None-Match": etag } });
  check("cold MISS + matching If-None-Match → 304 to the client…", first.status === 304 && first.headers.get("X-Cache") === "MISS");
  check("…the app ran WITHOUT the validator (so it produced a storable 200)…", hc.calls.length === 1 && !hc.calls[0].headers.has("If-None-Match"));
  check("…and the entry was stored", cold.puts.length === 1);
  const next = await hc.fetch(url);
  check("the next plain GET is a HIT", next.headers.get("X-Cache") === "HIT" && hc.calls.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("A cache failure never fails the request");
{
  const brokenMatch: CacheLike = { match: async () => { throw new Error("cache unavailable"); }, put: async () => {} };
  const a = harness(brokenMatch, runReal);
  const r1 = await a.fetch(U + "/api/latest");
  check("match() throwing → the app still answers", r1.status === 200 && a.calls.length === 1);

  const brokenPut: CacheLike = { match: async () => undefined, put: async () => { throw new Error("quota exceeded"); } };
  const b = harness(brokenPut, runReal);
  const r2 = await b.fetch(U + "/api/latest");
  check("put() rejecting → the response is still served (error swallowed)", r2.status === 200 && (await r2.text()).includes("dataVersion"));

  const syncPut: CacheLike = { match: async () => undefined, put: (() => { throw new Error("sync boom"); }) as CacheLike["put"] };
  const c = harness(syncPut, runReal);
  check("put() throwing synchronously → still served", (await c.fetch(U + "/api/latest")).status === 200);

  // The background write is handed to waitUntil (it must outlive the response on Workers).
  const pending: Promise<unknown>[] = [];
  const fake = new FakeCache();
  await withEdgeCache(new Request(U + "/api/latest"), runReal, { cache: fake, waitUntil: (p) => pending.push(p) });
  check("the cache write is registered with waitUntil", pending.length === 1);
  await Promise.all(pending);
  check("…and completes once waitUntil settles", fake.puts.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Profile-view instrumentation (views.ts)");
{
  const rq = (path: string, method = "GET") => new Request(U + path, { method });
  check("profile view key for an explicit bioguide (upper-cased)", profileViewKey(rq("/api/profile?bioguide=o000172")) === "views:O000172");
  check("…and for the default demo member", profileViewKey(rq("/api/profile")) === "views:O000172");
  check("…tolerates a trailing slash", profileViewKey(rq("/api/profile/?bioguide=A000055")) === "views:A000055");
  check("no key for a malformed bioguide, other routes, or non-GET", profileViewKey(rq("/api/profile?bioguide=bad!")) === null && profileViewKey(rq("/api/members")) === null && profileViewKey(rq("/api/profile", "POST")) === null && profileViewKey(rq("/api/v/abc/profile/O000172")) === null);

  const store = new MemoryStore();
  const pending: Promise<unknown>[] = [];
  const wu = (p: Promise<unknown>) => { pending.push(p); };
  recordProfileView(rq("/api/profile?bioguide=O000172"), store, wu);
  recordProfileView(rq("/api/profile?bioguide=O000172"), store, wu);
  recordProfileView(rq("/api/members"), store, wu);
  check("only profile views are counted, via waitUntil (2 registered)", pending.length === 2);
  await Promise.all(pending);
  check("views:{bioguide} is incremented once per profile view", (await store.get("views:O000172")) === "2");

  // KV write failures (e.g. the free-plan daily cap) must never fail or even surface.
  const failing: Store = { get: async () => null, put: async () => {}, incr: async () => { throw new Error("KV put() limit exceeded for the day"); } };
  const p2: Promise<unknown>[] = [];
  let threw = false;
  try { recordProfileView(rq("/api/profile"), failing, (p) => p2.push(p)); } catch { threw = true; }
  const settled = await Promise.allSettled(p2);
  check("a rejecting store.incr is swallowed (no throw, waitUntil promise resolves)", !threw && p2.length === 1 && settled[0].status === "fulfilled");
  const syncThrow: Store = { get: async () => null, put: async () => {}, incr: (() => { throw new Error("sync"); }) as Store["incr"] };
  let threw2 = false;
  try { recordProfileView(rq("/api/profile"), syncThrow, () => {}); } catch { threw2 = true; }
  check("a synchronously throwing store is swallowed too", !threw2);
  let threw3 = false;
  try { recordProfileView(rq("/api/profile"), store, () => { throw new Error("waitUntil unavailable"); }); } catch { threw3 = true; }
  check("a throwing waitUntil is swallowed", !threw3);
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────
console.log(`\n  ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error("  FAILED: " + fails.join(", ")); process.exit(1); }

/**
 * Edge response caching for the Workers host — so the government APIs behind this app are hit
 * only on cache MISSES, matching what `SwrCache` does for the Node server.
 *
 * Why this exists: a Worker's response is dynamic. Setting `Cache-Control: s-maxage=300` on it does
 * NOT make Cloudflare store it (only static assets get that for free), so every request would run
 * the route and call Congress.gov again. The Cache API (`caches.default`) is the explicit way to
 * store a dynamic response, and this module is the policy for what goes in it.
 *
 * Host-agnostic on purpose: it only needs something shaped like the Cache API (`CacheLike`) and a
 * `waitUntil`, so the tests drive it with a Map-backed fake and no Workers runtime.
 *
 * Caveats worth knowing (verify after deploy — see DEPLOY.md):
 *   - The Cache API is PER DATA CENTER: an entry cached in one city isn't visible in another, so a
 *     popular route can still be fetched once per colo per TTL. (Tiered Cache / KV L2 come later.)
 *   - Cloudflare documents Cache API operations for Workers on CUSTOM DOMAINS. Don't assume they
 *     do anything on `*.workers.dev`; check the `X-Cache` header there before relying on it.
 *   - The Cache API ignores `stale-while-revalidate` / `stale-if-error`: an entry is served until
 *     its `s-maxage` runs out, then the next request is a miss and refetches. (Edge SWR: task 5.2.)
 */

/** The slice of the Workers Cache API we use (also trivially fakeable in tests). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** `/api/*` GETs whose URL carries personal data (an address / location) or whose answer is per-user. */
const NEVER_CACHE_PATHS = new Set(["/api/comments", "/api/reactions", "/api/reps"]);

/** Should we even look in / write to the cache for this request? GET `/api/*` only, minus the exclusions. */
export function isEdgeCacheableRequest(request: Request): boolean {
  if (request.method !== "GET") return false;
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api")) return false;
  return !NEVER_CACHE_PATHS.has(path);
}

/** Only successful responses the app itself marked shareable are stored. Errors / `no-store` never are. */
export function isEdgeCacheableResponse(response: Response): boolean {
  if (response.status !== 200) return false;
  const cc = (response.headers.get("Cache-Control") ?? "").toLowerCase();
  return /(^|[\s,])public([\s,]|$)/.test(cc) && !/(^|[\s,])(no-store|private)([\s,]|$)/.test(cc);
}

/**
 * The cache key: the URL alone as a plain GET. Request headers (If-None-Match, Accept-Encoding, …)
 * must not fragment the cache; conditional requests are answered from the stored entry below.
 */
const keyFor = (request: Request): Request => new Request(request.url, { method: "GET" });

export interface EdgeCacheOptions {
  cache: CacheLike;
  /** Keep the isolate alive until the background `cache.put` finishes (Workers `ctx.waitUntil`). */
  waitUntil: (promise: Promise<unknown>) => void;
}

/** Copy a response so we can add the `X-Cache` header (cache/Hono responses may have immutable headers). */
function withXCache(response: Response, state: "HIT" | "MISS" | "BYPASS"): Response {
  const out = new Response(response.body, response);
  out.headers.set("X-Cache", state);
  return out;
}

/** True when the client already holds exactly this version (`If-None-Match` equals the stored ETag). */
function clientHasVersion(request: Request, response: Response): boolean {
  const inm = request.headers.get("If-None-Match");
  const etag = response.headers.get("ETag");
  return Boolean(inm && etag && inm === etag);
}

/** Bodiless 304 carrying the stored response's headers (Cache-Control, ETag, security headers). */
function notModified(stored: Response, state: "HIT" | "MISS"): Response {
  const h = new Headers(stored.headers);
  h.delete("Content-Type"); h.delete("Content-Length"); h.delete("Content-Encoding");
  h.set("X-Cache", state);
  return new Response(null, { status: 304, headers: h });
}

/**
 * Serve `request` through the edge cache:
 *   - cacheable request + stored entry → return it (`X-Cache: HIT`) WITHOUT calling `run`
 *   - otherwise `run()` the app; a 200 + `public` response is stored in the background
 *     (`X-Cache: MISS`); everything else passes through (`X-Cache: BYPASS`)
 * Conditional requests (`If-None-Match`) are answered from the stored/fresh 200 as a 304. On a miss
 * the app is run WITHOUT the validator, so a browser revalidating its copy still fills the cache
 * instead of leaving it empty. A cache failure of any kind (match or put throwing) never fails the request.
 */
export async function withEdgeCache(request: Request, run: (request: Request) => Promise<Response>, opts: EdgeCacheOptions): Promise<Response> {
  if (!isEdgeCacheableRequest(request)) return withXCache(await run(request), "BYPASS");

  const key = keyFor(request);
  let hit: Response | undefined;
  try { hit = await opts.cache.match(key); } catch { hit = undefined; }
  if (hit) return clientHasVersion(request, hit) ? notModified(hit, "HIT") : withXCache(hit, "HIT");

  let upstreamRequest = request;
  if (request.headers.has("If-None-Match")) {
    const headers = new Headers(request.headers);
    headers.delete("If-None-Match");
    upstreamRequest = new Request(request.url, { method: "GET", headers });
  }
  const res = await run(upstreamRequest);
  if (!isEdgeCacheableResponse(res)) return withXCache(res, "BYPASS");

  // Store a clone (the original's body streams to the client); never let the write fail the request.
  const toStore = res.clone();
  opts.waitUntil((async () => { try { await opts.cache.put(key, toStore); } catch { /* cache write failed — serve anyway */ } })());
  return clientHasVersion(request, res) ? notModified(res, "MISS") : withXCache(res, "MISS");
}

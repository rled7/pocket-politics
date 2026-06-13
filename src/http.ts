/**
 * Shared HTTP caching helpers — the caching POLICY defined exactly once, so every API
 * endpoint is identical and the rules live in one place. Provider-portable by design:
 * these are standard Web `Request`/`Response` + standard `Cache-Control`, so the same
 * helper works on Cloudflare Pages Functions today and a persistent Node/Rust-fronting
 * server later (see CACHING_ARCHITECTURE.md and PERSISTENT_SERVER_DEPLOYMENT.md).
 */

/** Edge freshness window. Public record changes slowly, so 5 min is plenty. */
export const DEFAULT_SMAXAGE = 300;

/**
 * The standard cache directive for read endpoints:
 *  - `max-age=60`            browser holds it 1 min (cheap repeat views)
 *  - `s-maxage=300`          CDN holds it 5 min (shared; the real edge cache)
 *  - `stale-while-revalidate=86400`  after expiry, serve STALE instantly and revalidate in
 *                            the background — async SWR (live on Cloudflare 2026-02-26), so
 *                            no reader ever blocks on the origin.
 *  - `stale-if-error=86400`  if revalidation fails (gov API outage), keep serving stale 24h.
 */
export function cacheControl(sMaxAge: number = DEFAULT_SMAXAGE): string {
  return `public, max-age=60, s-maxage=${sMaxAge}, stale-while-revalidate=86400, stale-if-error=86400`;
}

/**
 * Weak ETag via FNV-1a (32-bit) over the body. Synchronous (no async Web Crypto), so it
 * runs unchanged in a Worker isolate or Node. Weak (`W/`) because it tags semantic content,
 * not a byte-exact entity — exactly right for JSON we may re-serialize.
 */
export function etagFor(body: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    // h *= 16777619, in 32-bit arithmetic
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `W/"${h.toString(16)}"`;
}

export interface JsonCachedOpts {
  /** Pass the incoming request to enable `If-None-Match` → `304 Not Modified`. */
  request?: Request;
  /** Override the CDN freshness window (seconds). */
  sMaxAge?: number;
  /** Success status (default 200). */
  status?: number;
  /** Extra response headers (merged last). */
  extraHeaders?: Record<string, string>;
}

/**
 * Build a cacheable JSON response with the standard directive + a content ETag. When the
 * client sends a matching `If-None-Match`, returns a bodiless `304` (saves the payload —
 * a real win for mobile / repeat readers).
 */
export function jsonCached(data: unknown, opts: JsonCachedOpts = {}): Response {
  const body = JSON.stringify(data);
  const etag = etagFor(body);
  const cc = cacheControl(opts.sMaxAge);

  const inm = opts.request?.headers.get("If-None-Match");
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers: { "Cache-Control": cc, ETag: etag } });
  }

  return new Response(body, {
    status: opts.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cc,
      ETag: etag,
      ...opts.extraHeaders,
    },
  });
}

/**
 * Error response — deliberately NOT cached (`no-store`). Upstream-outage resilience is
 * handled by `stale-if-error` on the *success* path; we never want to cache an error body.
 */
export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

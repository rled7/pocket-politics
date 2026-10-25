/**
 * Cloudflare Workers entry — the serverless host for the ONE Hono app (`app.ts`).
 *
 * What lives HERE and nowhere else (decoupling rule 1): reading the Workers `env` bindings, the KV
 * store binding, `CF-Connecting-IP`, the edge response cache (`caches.default`), `ctx.waitUntil`,
 * and the static-asset fallback. Routing, validation and responses are the shared app.
 *
 * Request flow:
 *   static page / asset        → served by Workers Static Assets directly, WITHOUT running this
 *                                Worker (security headers + `/` → home come from apps/web/_headers
 *                                and _redirects). Only paths with no matching asset reach `fetch`.
 *   /api/* and /healthz        → edge cache (edge_cache.ts) → the Hono app
 *   anything else (a 404 page) → assets fallback below, with the same plain-text 404 as the Node server
 *
 * Bindings (wrangler.toml): ASSETS (static files), POCKETPOL_KV (optional — without it the app
 * runs on the in-memory store). Secrets (CONGRESS_API_KEY, FEC_API_KEY, …) arrive as string
 * bindings on the same `env` and are read by `loadConfig`.
 */
import { createApp, isApiPath, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { getStore, type Store } from "./store.ts";
import { rateLimit } from "./ratelimit.ts";
import { withEdgeCache } from "./edge_cache.ts";
import { recordProfileView } from "./views.ts";
import { applySecurityHeaders } from "./security_headers.ts";

export type Env = {
  ASSETS: Fetcher;
  POCKETPOL_KV?: KVNamespace;
  /** Secrets and plain vars (CONGRESS_API_KEY, FEC_API_KEY, STRIPE_*, …) — strings read by loadConfig. */
  [binding: string]: unknown;
};

interface Host { app: App; store: Store; }
let host: Host | undefined;

/** Built once per isolate: config and bindings don't change between requests. */
function getHost(env: Env): Host {
  if (!host) {
    const store = getStore(env); // KV when bound, else in-memory (graceful)
    host = {
      store,
      app: createApp({
        config: loadConfig(env),
        store,
        // Per-isolate in-memory limiter: weaker than on Node because each isolate has its own
        // counters (EDGE_CASES.md "Per-isolate rate limits"; real fix is task 5.1).
        rateLimit,
        clientIp: (request) => request.headers.get("CF-Connecting-IP") ?? "unknown",
      }),
    };
  }
  return host;
}

/** Non-API requests that no static asset matched: mirror the Node server ("/" → home, plain 404). */
async function serveStaticFallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const target = url.pathname === "/" ? new Request(new URL("/home.html", url), request) : request;
  const asset = await env.ASSETS.fetch(target);
  if (asset.status === 404) {
    const notFound = new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    applySecurityHeaders(notFound.headers);
    return notFound;
  }
  const out = new Response(asset.body, asset);
  applySecurityHeaders(out.headers);
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!isApiPath(url.pathname)) return serveStaticFallback(request, env);

    const { app, store } = getHost(env);
    // Demand signal for the ingest optimizer: only when KV is bound (nothing durable otherwise).
    if (env.POCKETPOL_KV) recordProfileView(request, store, (p) => ctx.waitUntil(p));

    return withEdgeCache(request, async (req) => app.fetch(req, env, ctx), {
      cache: caches.default,
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};

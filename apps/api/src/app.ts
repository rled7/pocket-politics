/**
 * The ONE router. Every API route lives here, in a single Hono app built by `createApp(deps)`,
 * and both hosts run it unchanged:
 *   - `worker.ts` — Cloudflare Workers (+ static assets, KV, edge response cache)
 *   - `node.ts`   — the persistent Node server (SWR memory cache, prewarm, static files)
 *
 * DECOUPLING RULE 1 (PHASES.md): this module and everything it imports is host-agnostic. It never
 * reads `process.env`, never touches `node:fs`/`node:path`/`node:url`, and never assumes a runtime.
 * Everything host-specific arrives through `AppDeps`:
 *   - `config`    — API keys + Stripe price ids (config.ts `loadConfig`)
 *   - `store`     — comments, reactions, trending, translation cache (KV on Workers, memory on Node)
 *   - `rateLimit` — per-IP limiter for the unauthenticated POST routes
 *   - `clientIp`  — who is calling (CF-Connecting-IP on Workers; socket / X-Forwarded-For on Node)
 *
 * Behavior is the contract the build-95 parity capture pins: same validation, statuses, error
 * messages, bodies and Cache-Control/ETag/304 behavior (the http.ts helpers are used as-is).
 */
import { Hono, type Context } from "hono";
import { getMembers, getBills, getBillsWithSponsors, getBill, getProfile, getBillVotes, getReps, getRepsByCoords, clampLimit, isBioguide, DEFAULT_BIOGUIDE } from "./handlers.ts";
import { getMoney, getDonors } from "./money.ts";
import { jsonCached, jsonImmutable, jsonPointer, jsonError } from "./http.ts";
import { dataVersion } from "./version.ts";
import type { Store } from "./store.ts";
import { getComments, addComment, validBillId } from "./comments.ts";
import { getReactions, setReaction, isReaction, validClientId } from "./reactions.ts";
import { getLobbying } from "./lobbying.ts";
import { buildInfo } from "./build.ts";
import { getNyBills, getNyLaws, getNyTranscripts, getNyTranscript, getNyCalendars, getNyAgendas, getNyBill } from "./nystate.ts";
import { getStateData, isValidState, getCityOfficials } from "./openstates.ts";
import { getCalendar, OFFICIAL_CALENDARS } from "./calendar.ts";
import { getBudgetWatch } from "./budget.ts";
import { createCheckout, tiersPublic, paymentsConfigured } from "./payments.ts";
import { getCloture, getVoteDetail } from "./cloture.ts";
import { getTranslation } from "./translate.ts";
import { track, getTrending, validKind } from "./trending.ts";
import { getRecord } from "./record.ts";
import { getCommittees, getCrsReports } from "./committees.ts";
import { integrations, type Config } from "./config.ts";
import { applySecurityHeaders } from "./security_headers.ts";

/** Allow `max` hits per `windowMs` per key; `retryAfter` is in seconds. (ratelimit.ts `rateLimit` fits.) */
export type RateLimiter = (key: string, max: number, windowMs: number) => { ok: boolean; retryAfter: number };

export interface AppDeps {
  config: Config;
  store: Store;
  rateLimit: RateLimiter;
  /** The caller's address, for rate limiting. Each host knows how to find it. */
  clientIp: (request: Request) => string;
}

/** Paths the API app owns. Everything else is the static web client (served by the host). */
export const isApiPath = (pathname: string): boolean => pathname.startsWith("/api") || pathname === "/healthz";

const RATE_WINDOW_MS = 60_000;

/** JSON response for the write/never-cached routes (comments, reactions, track, translate, checkout). */
function sendJson(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Parse a JSON request body; an empty body is `{}`. Malformed JSON throws → generic 500, as before. */
async function readJson(c: Context): Promise<any> {
  return JSON.parse((await c.req.text()) || "{}");
}

/** The URL's query string, read exactly like the old hand-rolled router did (`q.get()` → null when absent). */
const queryOf = (c: Context): URLSearchParams => new URL(c.req.url).searchParams;

export function createApp(deps: AppDeps) {
  const { config, store } = deps;
  const app = new Hono({ strict: false }); // `/api/members/` behaves like `/api/members`

  /** Enforce a per-IP rate limit on a POST endpoint; returns a 429 response if rejected, else null. */
  const limited = (c: Context, bucket: string, max: number): Response | null => {
    const r = deps.rateLimit(`${bucket}:${deps.clientIp(c.req.raw)}`, max, RATE_WINDOW_MS);
    if (r.ok) return null;
    const res = sendJson(429, { error: "Too many requests — slow down a moment." });
    res.headers.set("Retry-After", String(r.retryAfter));
    return res;
  };

  // ── Every response (API, /healthz, 404s, errors) carries the security headers ────────────────
  app.use("*", async (c, next) => {
    await next();
    applySecurityHeaders(c.res.headers);
  });

  // ── Unknown route → the same JSON 404 as before ──────────────────────────────────────────────
  app.notFound(() => jsonError("not found", 404));

  // ── Errors: log the real error server-side, but never echo internal/upstream details (paths,
  // "FEC 429", stack frames) to the client — that's reconnaissance. Clients get a generic message. ─
  app.onError((err, c) => {
    console.error("[500]", c.req.method, c.req.url, err instanceof Error ? err.stack || err.message : err);
    return new Response(JSON.stringify({ error: "internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });

  // ── Health ───────────────────────────────────────────────────────────────────────────────────
  app.get("/healthz", () => new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }));

  // ── Meta / mutable pointers ──────────────────────────────────────────────────────────────────
  app.get("/api/latest", () => jsonPointer({ dataVersion: dataVersion() }));
  // Which data integrations are configured (booleans only — never exposes key values).
  app.get("/api/integrations", (c) => jsonCached({ integrations: integrations(config) }, { request: c.req.raw }));
  // Build / release version (human-facing app version + build number + data version).
  app.get("/api/version", (c) => jsonCached({ ...buildInfo(), dataVersion: dataVersion() }, { request: c.req.raw }));
  // Trending — what people are engaging with most (the "observe" half of #39).
  app.get("/api/trending", async (c) => {
    const q = queryOf(c);
    const kind = q.get("kind") ?? "bill";
    if (!validKind(kind)) return jsonError("kind must be bill or member", 400);
    return jsonCached({ kind, items: await getTrending(store, kind, clampLimit(q.get("limit"), 8, 15)) }, { request: c.req.raw, sMaxAge: 30 });
  });
  // Pricing tiers (no secrets) + whether payments are configured.
  app.get("/api/pricing", (c) => jsonCached({ tiers: tiersPublic(), configured: paymentsConfigured(config.stripeSecret) }, { request: c.req.raw }));

  // ── Federal (Congress.gov) ───────────────────────────────────────────────────────────────────
  app.get("/api/members", async (c) => {
    const q = queryOf(c);
    return jsonCached(await getMembers(clampLimit(q.get("limit"), 540, 540), config.congress), { request: c.req.raw });
  });
  app.get("/api/bills", async (c) => {
    const q = queryOf(c);
    const lim = clampLimit(q.get("limit"), 20, 50);
    if (q.get("sponsors")) return jsonCached(await getBillsWithSponsors(lim, config.congress), { request: c.req.raw });
    return jsonCached(await getBills(lim, config.congress), { request: c.req.raw });
  });
  app.get("/api/profile", async (c) => {
    const q = queryOf(c);
    const b = (q.get("bioguide") || DEFAULT_BIOGUIDE).toUpperCase();
    if (!isBioguide(b)) return jsonError("Invalid bioguide id (expected e.g. O000172)", 400);
    return jsonCached(await getProfile(b, config.congress), { request: c.req.raw });
  });
  app.get("/api/votes", async (c) => {
    const q = queryOf(c);
    const congress = parseInt(q.get("congress") ?? "118", 10) || 118;
    return jsonCached(await getBillVotes(congress, q.get("type") ?? "hr", q.get("number") ?? "1", config.congress), { request: c.req.raw });
  });
  app.get("/api/bill", async (c) => {
    const q = queryOf(c);
    const congress = parseInt(q.get("congress") ?? "118", 10) || 118;
    return jsonCached(await getBill(congress, q.get("type") ?? "hr", q.get("number") ?? "1", config.congress), { request: c.req.raw });
  });

  // ── New York State (NY Senate Open Legislation) ──────────────────────────────────────────────
  app.get("/api/ny/bills", async (c) => {
    const q = queryOf(c);
    return jsonCached(await getNyBills(clampLimit(q.get("limit"), 20, 50), config.nyOpenLeg), { request: c.req.raw });
  });
  app.get("/api/ny/bill", async (c) => {
    const q = queryOf(c);
    const pn = (q.get("printNo") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const sess = parseInt(q.get("session") ?? "", 10) || new Date().getFullYear();
    if (!/^[A-Z]\d+$/.test(pn)) return jsonError("printNo required (e.g. A8506)", 400);
    return jsonCached(await getNyBill(sess, pn, config.nyOpenLeg), { request: c.req.raw, sMaxAge: 1800 });
  });
  app.get("/api/ny/laws", async (c) => jsonCached(await getNyLaws(config.nyOpenLeg), { request: c.req.raw }));
  app.get("/api/ny/transcripts", async (c) => {
    const q = queryOf(c);
    return jsonCached(await getNyTranscripts(clampLimit(q.get("limit"), 12, 30), config.nyOpenLeg), { request: c.req.raw });
  });
  app.get("/api/ny/transcript", async (c) => {
    const q = queryOf(c);
    const dt = (q.get("dateTime") ?? "").slice(0, 25);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dt)) return jsonError("dateTime required (e.g. 2026-05-21T11:17)", 400);
    return jsonCached(await getNyTranscript(dt, config.nyOpenLeg), { request: c.req.raw, sMaxAge: 86400 }); // immutable record → cache a day
  });
  app.get("/api/ny/calendars", async (c) => jsonCached(await getNyCalendars(config.nyOpenLeg), { request: c.req.raw }));
  app.get("/api/ny/agendas", async (c) => jsonCached(await getNyAgendas(config.nyOpenLeg), { request: c.req.raw }));

  // ── Budget, Senate, Congressional Record, calendar, committees ───────────────────────────────
  app.get("/api/budget", async (c) => jsonCached(await getBudgetWatch(config.congress), { request: c.req.raw, sMaxAge: 3600 }));
  app.get("/api/cloture/vote", async (c) => {
    const q = queryOf(c);
    const cg = parseInt(q.get("congress") ?? "119", 10) || 119, s = parseInt(q.get("session") ?? "2", 10) || 2;
    const num = (q.get("num") ?? "").replace(/\D/g, "").slice(0, 5);
    if (!num) return jsonError("num required (vote number)", 400);
    return jsonCached(await getVoteDetail(cg, s, num), { request: c.req.raw, sMaxAge: 86400 }); // votes are final → cache a day
  });
  app.get("/api/cloture", async (c) => jsonCached(await getCloture(), { request: c.req.raw, sMaxAge: 1800 }));
  app.get("/api/record", async (c) => {
    const q = queryOf(c);
    return jsonCached(await getRecord(clampLimit(q.get("limit"), 14, 30), config.congress), { request: c.req.raw, sMaxAge: 3600 });
  });
  app.get("/api/calendar", async (c) => {
    const cal = await getCalendar(config.congress);
    return jsonCached({ ...cal, official: OFFICIAL_CALENDARS }, { request: c.req.raw, sMaxAge: 3600 });
  });
  app.get("/api/committees", async (c) => jsonCached(await getCommittees(config.congress), { request: c.req.raw, sMaxAge: 86400 }));
  app.get("/api/crs", async (c) => {
    const q = queryOf(c);
    return jsonCached(await getCrsReports(config.congress, clampLimit(q.get("limit"), 20, 50)), { request: c.req.raw, sMaxAge: 3600 });
  });

  // ── Local / other states (OpenStates) ────────────────────────────────────────────────────────
  app.get("/api/local/officials", async (c) => {
    const q = queryOf(c);
    const st = (q.get("state") ?? "").slice(0, 40).trim(), city = (q.get("city") ?? "").slice(0, 60).trim();
    if (!isValidState(st) || !city) return jsonError("state + city required", 400);
    return jsonCached(await getCityOfficials(st, city, config.openStates), { request: c.req.raw, sMaxAge: 1800 });
  });
  app.get("/api/state", async (c) => {
    const q = queryOf(c);
    const st = (q.get("state") ?? "").slice(0, 40).trim();
    if (!isValidState(st)) return jsonError("unknown state — use a full state name, e.g. ?state=California", 400);
    // Long TTL: OpenStates is rate-limited (500/day) and state data changes slowly.
    return jsonCached(await getStateData(st, config.openStates), { request: c.req.raw, sMaxAge: 1800 });
  });

  // ── Money & lobbying ─────────────────────────────────────────────────────────────────────────
  app.get("/api/lobbying", async (c) => {
    const q = queryOf(c);
    const yr = parseInt(q.get("year") ?? "", 10);
    const year = Number.isFinite(yr) ? yr : new Date().getFullYear();
    return jsonCached(await getLobbying((q.get("q") ?? "").slice(0, 120), config.lda, year), { request: c.req.raw });
  });
  app.get("/api/money", async (c) => {
    const q = queryOf(c);
    const b = (q.get("bioguide") || DEFAULT_BIOGUIDE).toUpperCase();
    if (!isBioguide(b)) return jsonError("Invalid bioguide id (expected e.g. O000172)", 400);
    return jsonCached(await getMoney(b, config.fec), { request: c.req.raw });
  });
  app.get("/api/donors", async (c) => {
    const q = queryOf(c);
    const b = (q.get("bioguide") || DEFAULT_BIOGUIDE).toUpperCase();
    if (!isBioguide(b)) return jsonError("Invalid bioguide id", 400);
    return jsonCached(await getDonors(b, config.fec), { request: c.req.raw, sMaxAge: 86400 });
  });

  // ── Your representatives (address / coordinates in the URL → never edge-cached, see edge_cache.ts) ─
  app.get("/api/reps", async (c) => {
    const q = queryOf(c);
    const lat = parseFloat(q.get("lat") ?? ""), lon = parseFloat(q.get("lon") ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lon)) return jsonCached(await getRepsByCoords(lat, lon, config.congress), { request: c.req.raw });
    const addr = (q.get("address") ?? "").trim();
    if (!addr) return jsonError("address or lat/lon required", 400);
    return jsonCached(await getReps(addr, config.congress), { request: c.req.raw });
  });

  // ── Immutable, version-addressed: /api/v/{ver}/... (cache for a year) ────────────────────────
  app.get("/api/v/:version/members", async (c) => jsonImmutable(await getMembers(540, config.congress), { request: c.req.raw }));
  app.get("/api/v/:version/bills", async (c) => jsonImmutable(await getBills(50, config.congress), { request: c.req.raw }));
  app.get("/api/v/:version/profile/:bioguide", async (c) => {
    const b = c.req.param("bioguide").toUpperCase();
    if (!isBioguide(b)) return jsonError("Invalid bioguide id (expected e.g. O000172)", 400);
    return jsonImmutable(await getProfile(b, config.congress), { request: c.req.raw });
  });

  // ── Bill comments — read + write, never cached ───────────────────────────────────────────────
  app.get("/api/comments", async (c) => {
    const bill = queryOf(c).get("bill") ?? "";
    if (!validBillId(bill)) return sendJson(400, { error: "invalid bill id" });
    return sendJson(200, { comments: await getComments(store, bill) });
  });
  app.post("/api/comments", async (c) => {
    const rejected = limited(c, "comments", 20);
    if (rejected) return rejected;
    const payload = await readJson(c);
    const bill = String(payload.bill ?? "");
    if (!validBillId(bill)) return sendJson(400, { error: "invalid bill id" });
    try {
      const comments = await addComment(store, bill, {
        author: payload.author, district: payload.district, email: payload.email, text: payload.text,
      });
      return sendJson(200, { comments });
    } catch (e) { return sendJson(400, { error: e instanceof Error ? e.message : "bad request" }); }
  });

  // ── Engagement tracking — feeds the "trending" surface (#39). Fire-and-forget, rate-limited. ─
  app.post("/api/track", async (c) => {
    const rejected = limited(c, "track", 60);
    if (rejected) return rejected;
    const p = await readJson(c);
    await track(store, String(p.kind ?? ""), String(p.id ?? ""), p.label ? String(p.label) : undefined);
    return sendJson(200, { ok: true });
  });

  // ── Bill translation (AI) — legalese → plain English + dual key points. Cached per bill in the Store. ─
  app.post("/api/translate", async (c) => {
    const rejected = limited(c, "translate", 10); // paid AI path — strictest cap
    if (rejected) return rejected;
    const payload = await readJson(c);
    const bill = String(payload.billId ?? "");
    if (!validBillId(bill)) return sendJson(400, { error: "invalid bill id" });
    const text = String(payload.text ?? "").slice(0, 8000);
    return sendJson(200, await getTranslation(bill, text, store, config));
  });

  // ── Stripe Checkout — create a hosted-checkout session and hand back the URL. Never cached. ──
  app.post("/api/checkout", async (c) => {
    const rejected = limited(c, "checkout", 20);
    if (rejected) return rejected;
    const payload = await readJson(c);
    const tier = String(payload.tier ?? "");
    // Success/cancel URLs point back at whatever origin the caller used (the host builds the Request
    // URL from its public address: Host + X-Forwarded-Proto on Node, the real URL on Workers).
    const result = await createCheckout(tier, new URL(c.req.url).origin, config);
    return sendJson(result.error ? 400 : 200, result);
  });

  // ── Bill reactions (like / dislike / neutral) — read + write, never cached ───────────────────
  app.get("/api/reactions", async (c) => {
    const q = queryOf(c);
    const client = q.get("client") ?? undefined;
    const bills = q.get("bills"); // batch: load a whole feed in one request
    if (bills) {
      const ids = bills.split(",").filter(validBillId).slice(0, 100);
      const reactions: Record<string, unknown> = {};
      for (const id of ids) reactions[id] = await getReactions(store, id, client);
      return sendJson(200, { reactions });
    }
    const bill = q.get("bill") ?? "";
    if (!validBillId(bill)) return sendJson(400, { error: "invalid bill id" });
    return sendJson(200, await getReactions(store, bill, client));
  });
  app.post("/api/reactions", async (c) => {
    const rejected = limited(c, "reactions", 60);
    if (rejected) return rejected;
    const payload = await readJson(c);
    const bill = String(payload.bill ?? "");
    const client = String(payload.client ?? "");
    const reaction = String(payload.reaction ?? "");
    if (!validBillId(bill)) return sendJson(400, { error: "invalid bill id" });
    if (!validClientId(client)) return sendJson(400, { error: "invalid client id" });
    if (!isReaction(reaction)) return sendJson(400, { error: "reaction must be like, dislike, or neutral" });
    return sendJson(200, await setReaction(store, bill, client, reaction));
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

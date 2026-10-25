/**
 * Route tests for the ONE Hono app (app.ts). No test framework — runs under `tsx`, asserts, and
 * exits non-zero on failure (same style as http.test.ts).
 *
 * Every request goes through `app.request()` against a MemoryStore with a key-less config, and the
 * global `fetch` is stubbed to reject — so every route answers from its bundled fixture or its
 * offline fallback, deterministically, with zero network. A route-coverage check at the end FAILS
 * if any route registered on the app has no test (and, for routes that validate input, no
 * validation-error test), so adding a route without a test breaks `pnpm test`.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, isApiPath, type App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { MemoryStore, type Store } from "./store.ts";
import { rateLimit } from "./ratelimit.ts";
import { SECURITY_HEADERS } from "./security_headers.ts";
import { buildInfo } from "./build.ts";
import { dataVersion } from "./version.ts";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name}`); }
}
const section = (s: string) => console.log(`\n${s}`);

// ── Offline by default: any outbound fetch rejects (→ fixtures / offline fallbacks) ─────────────
type FetchStub = (url: string, init?: RequestInit) => Response | Promise<Response>;
let fetchStub: FetchStub | null = null;
const outbound: { url: string; init?: RequestInit }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  outbound.push({ url, init });
  if (fetchStub) return fetchStub(url, init);
  throw new TypeError("fetch failed (offline test)");
}) as typeof fetch;

// Silence + capture the app's server-side error log so the 500 tests can assert on it.
const realConsoleError = console.error;
let errorLog: unknown[][] = [];
console.error = (...args: unknown[]) => { errorLog.push(args); };

// ── Test harness ────────────────────────────────────────────────────────────────────────────────
const store = new MemoryStore();
const config = loadConfig({}); // no keys at all
const IP_HEADER = "x-test-ip";
const makeDeps = (s: Store = store, cfg = config) => ({
  config: cfg,
  store: s,
  rateLimit,
  clientIp: (request: Request) => request.headers.get(IP_HEADER) ?? "default-test-ip",
});
const app = createApp(makeDeps());

const J = { "Content-Type": "application/json" };
const post = (body: unknown, ip?: string): RequestInit => ({
  method: "POST", headers: ip ? { ...J, [IP_HEADER]: ip } : J, body: JSON.stringify(body),
});
const body = async (r: Response): Promise<any> => r.json();

/** "GET /api/v/:version/members" pattern vs a concrete pathname (":x" = one segment). */
function patternMatches(pattern: string, pathname: string): boolean {
  const p = pattern.split("/"), q = pathname.replace(/\/+$/, "").split("/");
  return p.length === q.length && p.every((seg, i) => seg.startsWith(":") || seg === q[i]);
}

type Kind = "ok" | "err";
const coverage = new Map<string, Set<Kind>>();
/** Send a request AND record which registered route it exercises (label must match the request). */
async function hit(label: string, kind: Kind, path: string, init: RequestInit = {}, target: App = app): Promise<Response> {
  const [method, pattern] = label.split(" ");
  const url = new URL(path, "http://localhost");
  if ((init.method ?? "GET") !== method || !patternMatches(pattern, url.pathname)) {
    check(`test label "${label}" matches the request it sends (${init.method ?? "GET"} ${url.pathname})`, false);
  }
  if (!coverage.has(label)) coverage.set(label, new Set());
  coverage.get(label)!.add(kind);
  return target.request(path, init);
}
const cacheControl = (r: Response) => r.headers.get("Cache-Control") ?? "";
const isPublicCached = (r: Response) => /^public, max-age=60, s-maxage=\d+, stale-while-revalidate=86400, stale-if-error=86400$/.test(cacheControl(r));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Health + meta");
{
  const r = await hit("GET /healthz", "ok", "/healthz");
  check("/healthz → 200 {ok:true}", r.status === 200 && (await body(r)).ok === true);

  const l = await hit("GET /api/latest", "ok", "/api/latest");
  check("/api/latest → dataVersion pointer with short SWR cache", l.status === 200 && (await body(l)).dataVersion === dataVersion() && cacheControl(l).includes("max-age=30"));

  const i = await hit("GET /api/integrations", "ok", "/api/integrations");
  const ib = await body(i);
  check("/api/integrations lists every integration, none configured with a key-less config",
    i.status === 200 && ib.integrations.length === 8 && ib.integrations.every((x: any) => x.configured === false && !("value" in x)));
  // Config really is injected: a second app with a key reports it configured — and never leaks the value.
  const keyed = createApp(makeDeps(new MemoryStore(), loadConfig({ CONGRESS_API_KEY: "sekret-congress-key-123" })));
  const ki = await hit("GET /api/integrations", "ok", "/api/integrations", {}, keyed);
  const kt = await ki.text();
  check("/api/integrations reflects the injected config and never leaks key values",
    JSON.parse(kt).integrations.find((x: any) => x.id === "congress").configured === true && !kt.includes("sekret-congress-key-123"));

  const v = await hit("GET /api/version", "ok", "/api/version");
  const vb = await body(v);
  check("/api/version = buildInfo + dataVersion", v.status === 200 && vb.tag === buildInfo().tag && vb.build === buildInfo().build && vb.dataVersion === dataVersion());

  const p = await hit("GET /api/pricing", "ok", "/api/pricing");
  const pb = await body(p);
  check("/api/pricing → 3 tiers, payments not configured, no price env names leaked",
    p.status === 200 && pb.tiers.length === 3 && pb.configured === false && !JSON.stringify(pb).includes("STRIPE_PRICE"));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Federal data (Congress.gov fixtures)");
{
  const m = await hit("GET /api/members", "ok", "/api/members?limit=5");
  const mb = await body(m);
  check("/api/members → fixture directory, live:false, public SWR cache headers",
    m.status === 200 && mb.live === false && Array.isArray(mb.members) && mb.count === mb.members.length && isPublicCached(m) && !!m.headers.get("ETag"));
  // Conditional GET: a client holding the current ETag gets a bodiless 304 that still carries Cache-Control.
  const m304 = await hit("GET /api/members", "ok", "/api/members?limit=5", { headers: { "If-None-Match": m.headers.get("ETag")! } });
  check("/api/members + matching If-None-Match → 304, no body, Cache-Control + ETag kept",
    m304.status === 304 && (await m304.text()) === "" && cacheControl(m304).includes("s-maxage") && m304.headers.get("ETag") === m.headers.get("ETag"));
  const mSlash = await hit("GET /api/members", "ok", "/api/members/");
  check("a trailing slash routes the same (/api/members/)", mSlash.status === 200);

  const b = await hit("GET /api/bills", "ok", "/api/bills?limit=3");
  const bb = await body(b);
  check("/api/bills → fixture bills", b.status === 200 && bb.live === false && Array.isArray(bb.bills) && isPublicCached(b));
  const bs = await hit("GET /api/bills", "ok", "/api/bills?limit=3&sponsors=1");
  check("/api/bills?sponsors=1 → same shape (no key: nothing to enrich)", bs.status === 200 && Array.isArray((await body(bs)).bills));

  const pr = await hit("GET /api/profile", "ok", "/api/profile?bioguide=O000172");
  const prb = await body(pr);
  check("/api/profile → fixture profile", pr.status === 200 && prb.live === false && isPublicCached(pr));
  const prLower = await hit("GET /api/profile", "ok", "/api/profile?bioguide=o000172");
  check("/api/profile upper-cases the bioguide", prLower.status === 200);
  const prDefault = await hit("GET /api/profile", "ok", "/api/profile");
  check("/api/profile defaults to the demo member", prDefault.status === 200);
  const prBad = await hit("GET /api/profile", "err", "/api/profile?bioguide=bad!");
  check("/api/profile rejects a malformed bioguide → 400 no-store, exact message",
    prBad.status === 400 && (await body(prBad)).error === "Invalid bioguide id (expected e.g. O000172)" && cacheControl(prBad) === "no-store");

  const vo = await hit("GET /api/votes", "ok", "/api/votes?congress=118&type=hr&number=1");
  check("/api/votes → fixture roll calls", vo.status === 200 && (await body(vo)).live === false);
  const bi = await hit("GET /api/bill", "ok", "/api/bill?congress=118&type=hr&number=1");
  check("/api/bill → fixture bill detail", bi.status === 200 && (await body(bi)).live === false);

  const bu = await hit("GET /api/budget", "ok", "/api/budget");
  const bub = await body(bu);
  check("/api/budget → bundled fixture appropriations (no filesystem), 1h cache", bu.status === 200 && bub.appropriations.length > 0 && /Demo data/.test(bub.note) && cacheControl(bu).includes("s-maxage=3600"));
  const cl = await hit("GET /api/cloture", "ok", "/api/cloture");
  const clb = await body(cl);
  check("/api/cloture → offline falls back to the bundled senate fixture", cl.status === 200 && clb.live === false && clb.votes.length > 0);
  const clv = await hit("GET /api/cloture/vote", "ok", "/api/cloture/vote?congress=119&session=2&num=100");
  const clvb = await body(clv);
  check("/api/cloture/vote → degrades to an empty detail with a note when senate.gov is unreachable",
    clv.status === 200 && clvb.live === false && clvb.voteNumber === "100" && /unavailable/i.test(clvb.note) && cacheControl(clv).includes("s-maxage=86400"));
  const clvBad = await hit("GET /api/cloture/vote", "err", "/api/cloture/vote");
  check("/api/cloture/vote requires num → 400", clvBad.status === 400 && (await body(clvBad)).error === "num required (vote number)");
  const re = await hit("GET /api/record", "ok", "/api/record?limit=3");
  check("/api/record → fixture issues", re.status === 200 && (await body(re)).issues.length > 0);
  const ca = await hit("GET /api/calendar", "ok", "/api/calendar");
  const cab = await body(ca);
  check("/api/calendar → fixture meetings + official calendar links", ca.status === 200 && cab.meetings.length > 0 && cab.official.length > 0);
  const co = await hit("GET /api/committees", "ok", "/api/committees");
  check("/api/committees → no key: clean 'set CONGRESS_API_KEY' note, no fabrication", co.status === 200 && (await body(co)).committees.length === 0 && cacheControl(co).includes("s-maxage=86400"));
  const crs = await hit("GET /api/crs", "ok", "/api/crs?limit=3");
  check("/api/crs → no key: clean note", crs.status === 200 && (await body(crs)).reports.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("New York State, other states, local officials");
{
  const nb = await hit("GET /api/ny/bills", "ok", "/api/ny/bills?limit=3");
  check("/api/ny/bills → fixture", nb.status === 200 && (await body(nb)).bills.length > 0);
  const n1 = await hit("GET /api/ny/bill", "ok", "/api/ny/bill?printNo=A8506&session=2025");
  check("/api/ny/bill → detail (30 min cache)", n1.status === 200 && cacheControl(n1).includes("s-maxage=1800"));
  const n1Bad = await hit("GET /api/ny/bill", "err", "/api/ny/bill?printNo=zz");
  check("/api/ny/bill rejects a bad printNo → 400", n1Bad.status === 400 && (await body(n1Bad)).error === "printNo required (e.g. A8506)");
  const nl = await hit("GET /api/ny/laws", "ok", "/api/ny/laws");
  check("/api/ny/laws → fixture", nl.status === 200 && (await body(nl)).laws.length > 0);
  const nt = await hit("GET /api/ny/transcripts", "ok", "/api/ny/transcripts?limit=2");
  check("/api/ny/transcripts → fixture", nt.status === 200 && (await body(nt)).transcripts.length > 0);
  const nt1 = await hit("GET /api/ny/transcript", "ok", "/api/ny/transcript?dateTime=2026-05-21T11:17");
  check("/api/ny/transcript → a day of cache", nt1.status === 200 && cacheControl(nt1).includes("s-maxage=86400"));
  const nt1Bad = await hit("GET /api/ny/transcript", "err", "/api/ny/transcript?dateTime=bad");
  check("/api/ny/transcript rejects a bad dateTime → 400", nt1Bad.status === 400 && /dateTime required/.test((await body(nt1Bad)).error));
  const nc = await hit("GET /api/ny/calendars", "ok", "/api/ny/calendars");
  check("/api/ny/calendars → fixture", nc.status === 200 && (await body(nc)).calendars.length > 0);
  const na = await hit("GET /api/ny/agendas", "ok", "/api/ny/agendas");
  check("/api/ny/agendas → fixture", na.status === 200 && (await body(na)).agendas.length > 0);

  const lo = await hit("GET /api/local/officials", "ok", "/api/local/officials?state=New%20York&city=New%20York");
  check("/api/local/officials → fixture (30 min cache)", lo.status === 200 && cacheControl(lo).includes("s-maxage=1800"));
  const loBad = await hit("GET /api/local/officials", "err", "/api/local/officials");
  check("/api/local/officials needs state + city → 400", loBad.status === 400 && (await body(loBad)).error === "state + city required");
  const st = await hit("GET /api/state", "ok", "/api/state?state=New%20York");
  check("/api/state → fixture legislators + bills", st.status === 200 && (await body(st)).legislators.length > 0);
  const stBad = await hit("GET /api/state", "err", "/api/state?state=Atlantis");
  check("/api/state rejects an unknown state (allowlist) → 400", stBad.status === 400 && /unknown state/.test((await body(stBad)).error));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Money, lobbying, reps");
{
  const lb = await hit("GET /api/lobbying", "ok", "/api/lobbying?q=housing&year=2025");
  const lbb = await body(lb);
  check("/api/lobbying → fixture filings with a demo note", lb.status === 200 && lbb.live === false && lbb.filings.length > 0 && /Demo data/.test(lbb.note));
  const lbEmpty = await hit("GET /api/lobbying", "ok", "/api/lobbying");
  check("/api/lobbying with no query → asks for an issue, no filings", lbEmpty.status === 200 && (await body(lbEmpty)).filings.length === 0);

  const mo = await hit("GET /api/money", "ok", "/api/money?bioguide=O000172");
  const mob = await body(mo);
  check("/api/money → fixture totals echo the bioguide", mo.status === 200 && mob.live === false && mob.bioguide === "O000172" && !!mob.totals);
  const moBad = await hit("GET /api/money", "err", "/api/money?bioguide=bad!");
  check("/api/money rejects a malformed bioguide → 400", moBad.status === 400);
  const dn = await hit("GET /api/donors", "ok", "/api/donors?bioguide=O000172");
  check("/api/donors → no key: clean note (1 day cache)", dn.status === 200 && (await body(dn)).topEmployers.length === 0 && cacheControl(dn).includes("s-maxage=86400"));
  const dnBad = await hit("GET /api/donors", "err", "/api/donors?bioguide=nope");
  check("/api/donors rejects a malformed bioguide → 400", dnBad.status === 400 && (await body(dnBad)).error === "Invalid bioguide id");

  const rp = await hit("GET /api/reps", "ok", "/api/reps?address=1%20Centre%20St%20New%20York%20NY");
  const rpb = await body(rp);
  check("/api/reps by address → offline geocoder miss is a clean found:false (not a 500)", rp.status === 200 && rpb.found === false && Array.isArray(rpb.representatives));
  const rpc = await hit("GET /api/reps", "ok", "/api/reps?lat=40.71&lon=-74.0");
  check("/api/reps by coordinates → clean found:false offline", rpc.status === 200 && (await body(rpc)).found === false);
  const rpBad = await hit("GET /api/reps", "err", "/api/reps");
  check("/api/reps with neither address nor lat/lon → 400", rpBad.status === 400 && (await body(rpBad)).error === "address or lat/lon required");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Immutable, version-addressed routes");
{
  const vm = await hit("GET /api/v/:version/members", "ok", "/api/v/abc123/members");
  check("/api/v/{ver}/members → immutable for a year", vm.status === 200 && cacheControl(vm) === "public, max-age=31536000, immutable" && !!vm.headers.get("ETag"));
  const vm304 = await hit("GET /api/v/:version/members", "ok", "/api/v/abc123/members", { headers: { "If-None-Match": vm.headers.get("ETag")! } });
  check("/api/v/{ver}/members + matching ETag → 304", vm304.status === 304);
  const vb = await hit("GET /api/v/:version/bills", "ok", "/api/v/abc123/bills");
  check("/api/v/{ver}/bills → immutable", vb.status === 200 && cacheControl(vb).includes("immutable"));
  const vp = await hit("GET /api/v/:version/profile/:bioguide", "ok", "/api/v/abc123/profile/O000172");
  check("/api/v/{ver}/profile/{bioguide} → immutable profile", vp.status === 200 && cacheControl(vp).includes("immutable"));
  const vpBad = await hit("GET /api/v/:version/profile/:bioguide", "err", "/api/v/abc123/profile/bad!");
  check("/api/v/{ver}/profile/{bioguide} rejects a malformed bioguide → 400", vpBad.status === 400);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Bill comments (read + write)");
{
  const empty = await hit("GET /api/comments", "ok", "/api/comments?bill=118-hr-1");
  check("GET /api/comments → [] for a new bill, never cached", empty.status === 200 && (await body(empty)).comments.length === 0 && cacheControl(empty) === "no-store");
  const goodComment = { bill: "118-hr-1", author: "Test Voter", district: "NY-10", email: "voter@example.com", text: "Good for tenants in my district." };
  const ok = await hit("POST /api/comments", "ok", "/api/comments", post(goodComment));
  const okb = await body(ok);
  check("POST valid comment → 200 with the comment listed", ok.status === 200 && okb.comments.length === 1 && okb.comments[0].author === "Test Voter");
  check("the private email is never returned", !JSON.stringify(okb).includes("voter@example.com") && okb.comments[0].verified === false);
  const listed = await hit("GET /api/comments", "ok", "/api/comments?bill=118-hr-1");
  check("GET /api/comments lists the saved comment", (await body(listed)).comments.length === 1);

  const badEmail = await hit("POST /api/comments", "err", "/api/comments", post({ ...goodComment, email: "not-an-email" }));
  check("POST with a bad email → 400 naming the field", badEmail.status === 400 && /valid email/i.test((await body(badEmail)).error));
  const spam = await hit("POST /api/comments", "err", "/api/comments", post({ ...goodComment, text: "BUY NOW at www.spam.com" }));
  check("POST spam/link comment → 400 via moderation", spam.status === 400 && typeof (await body(spam)).error === "string");
  const badId = await hit("POST /api/comments", "err", "/api/comments", post({ ...goodComment, bill: "bad id!" }));
  check("POST with a bad bill id → 400 'invalid bill id'", badId.status === 400 && (await body(badId)).error === "invalid bill id");
  const noBill = await hit("POST /api/comments", "err", "/api/comments", post({ author: "x", text: "y" }));
  check("POST with no bill → 400 'invalid bill id'", noBill.status === 400 && (await body(noBill)).error === "invalid bill id");

  // Clients that still send the OLD payload (no district/email) get a clear 400, never a 500.
  const old = await hit("POST /api/comments", "err", "/api/comments", post({ bill: "118-hr-1", author: "Old Client", text: "Hello there" }));
  const oldb = await body(old);
  check("old-style {bill, author, text} payload → 400 with a clear message (not 500)", old.status === 400 && /district/i.test(oldb.error));

  const getBad = await hit("GET /api/comments", "err", "/api/comments?bill=bad%20id!");
  check("GET /api/comments with a bad bill id → 400", getBad.status === 400 && (await body(getBad)).error === "invalid bill id");

  // Malformed JSON is a server-side 500 with a generic body (details only in the log), as before.
  errorLog = [];
  const garbage = await hit("POST /api/comments", "err", "/api/comments", { method: "POST", headers: J, body: "{not json" });
  const gb = await garbage.text();
  check("POST malformed JSON → generic 500, body leaks nothing", garbage.status === 500 && JSON.parse(gb).error === "internal server error" && !/JSON|Unexpected|position/i.test(gb));
  check("…and the real error is logged server-side", errorLog.length === 1 && String(errorLog[0][0]) === "[500]" && /JSON/.test(String(errorLog[0][3])));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Engagement tracking + trending");
{
  const t0 = await hit("GET /api/trending", "ok", "/api/trending?kind=bill");
  check("GET /api/trending → empty items before any tracking, 30s cache", t0.status === 200 && (await body(t0)).items.length === 0 && cacheControl(t0).includes("s-maxage=30"));
  const tr = await hit("POST /api/track", "ok", "/api/track", post({ kind: "bill", id: "118-hr-1", label: "Test bill" }));
  check("POST /api/track → {ok:true}", tr.status === 200 && (await body(tr)).ok === true && cacheControl(tr) === "no-store");
  await hit("POST /api/track", "ok", "/api/track", post({ kind: "bill", id: "118-hr-1" }));
  const t1 = await hit("GET /api/trending", "ok", "/api/trending?kind=bill&limit=5");
  const t1b = await body(t1);
  check("GET /api/trending ranks tracked items with their label", t1b.items.length === 1 && t1b.items[0].id === "118-hr-1" && t1b.items[0].count === 2 && t1b.items[0].label === "Test bill");
  const trBad = await hit("POST /api/track", "err", "/api/track", post({ kind: "bogus", id: "../x" }));
  const t2 = await body(await hit("GET /api/trending", "ok", "/api/trending?kind=bill"));
  check("POST /api/track with a bad kind/id is ignored (200, nothing stored)", trBad.status === 200 && t2.items.length === 1);
  const tBad = await hit("GET /api/trending", "err", "/api/trending?kind=nope");
  check("GET /api/trending rejects an unknown kind → 400", tBad.status === 400 && (await body(tBad)).error === "kind must be bill or member");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Translate (AI) + checkout (Stripe)");
{
  const tr = await hit("POST /api/translate", "ok", "/api/translate", post({ billId: "118-hr-1", text: "An act to do things." }));
  const trb = await body(tr);
  check("POST /api/translate with no AI key → 200 enabled:false + setup note (not configured)", tr.status === 200 && trb.enabled === false && /API_KEY/.test(trb.note) && cacheControl(tr) === "no-store");
  const trBad = await hit("POST /api/translate", "err", "/api/translate", post({ billId: "bad id!", text: "x" }));
  check("POST /api/translate with a bad bill id → 400", trBad.status === 400 && (await body(trBad)).error === "invalid bill id");

  // Config is injected into translate too: with a key + a stubbed provider, it translates and caches.
  const aiStore = new MemoryStore();
  const aiApp = createApp(makeDeps(aiStore, loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test" })));
  const before = outbound.length;
  fetchStub = () => Response.json({ content: [{ text: JSON.stringify({ plainEnglish: "It does things.", keyPoints: [{ plain: "Things", legalese: "Whereas" }] }) }] });
  const t1 = await body(await hit("POST /api/translate", "ok", "/api/translate", post({ billId: "118-hr-2", text: "An act." }), aiApp));
  const t2 = await body(await hit("POST /api/translate", "ok", "/api/translate", post({ billId: "118-hr-2", text: "An act." }), aiApp));
  fetchStub = null;
  check("translate with an injected AI key calls the provider once, then serves the cached copy",
    t1.enabled === true && t1.plainEnglish === "It does things." && t1.cached === false && t2.cached === true && outbound.length - before === 1 && outbound[before].url.startsWith("https://api.anthropic.com/"));

  const co = await hit("POST /api/checkout", "ok", "/api/checkout", post({ tier: "pro" }));
  const cob = await body(co);
  check("POST /api/checkout with no Stripe key → 400 'not configured'", co.status === 400 && /not configured/i.test(cob.error) && cacheControl(co) === "no-store");

  const stripeApp = createApp(makeDeps(new MemoryStore(), loadConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_PRO: "price_pro_123" })));
  const unknown = await hit("POST /api/checkout", "err", "/api/checkout", post({ tier: "bogus" }), stripeApp);
  check("POST /api/checkout with an unknown tier → 400 'Unknown plan.'", unknown.status === 400 && (await body(unknown)).error === "Unknown plan.");
  const noPrice = await hit("POST /api/checkout", "err", "/api/checkout", post({ tier: "plus" }), stripeApp);
  check("POST /api/checkout for a tier with no Price ID → 400 naming the missing setting", noPrice.status === 400 && /STRIPE_PRICE_PLUS/.test((await body(noPrice)).error));
  const sBefore = outbound.length;
  fetchStub = () => Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  const good = await hit("POST /api/checkout", "ok", "https://pocketpolitics.example/api/checkout", post({ tier: "pro" }), stripeApp);
  fetchStub = null;
  const sent = new URLSearchParams(String(outbound[sBefore]?.init?.body));
  check("POST /api/checkout with a key + price id → 200 with the hosted URL; Price ID comes from injected config; return URLs use the caller's origin",
    good.status === 200 && (await body(good)).url === "https://checkout.stripe.com/c/pay/cs_test_1" &&
    sent.get("line_items[0][price]") === "price_pro_123" && sent.get("success_url") === "https://pocketpolitics.example/pricing.html?paid=1");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Bill reactions (read + write)");
{
  const bill = "118-hr-9", a = "client-aaaa-0001", b = "client-bbbb-0002";
  const r0 = await hit("GET /api/reactions", "ok", `/api/reactions?bill=${bill}&client=${a}`);
  const r0b = await body(r0);
  check("GET /api/reactions → zero tally, mine:null, never cached", r0.status === 200 && r0b.like === 0 && r0b.mine === null && cacheControl(r0) === "no-store");
  const set = await body(await hit("POST /api/reactions", "ok", "/api/reactions", post({ bill, client: a, reaction: "like" })));
  check("set: first like → like:1, mine:like", set.like === 1 && set.dislike === 0 && set.mine === "like");
  await hit("POST /api/reactions", "ok", "/api/reactions", post({ bill, client: b, reaction: "like" }));
  const moved = await body(await hit("POST /api/reactions", "ok", "/api/reactions", post({ bill, client: a, reaction: "dislike" })));
  check("move: switching like → dislike moves the vote (like:1 dislike:1)", moved.like === 1 && moved.dislike === 1 && moved.mine === "dislike");
  const retracted = await body(await hit("POST /api/reactions", "ok", "/api/reactions", post({ bill, client: a, reaction: "dislike" })));
  check("retract: repeating your reaction removes it (dislike:0, mine:null)", retracted.dislike === 0 && retracted.like === 1 && retracted.mine === null);
  const mine = await body(await hit("GET /api/reactions", "ok", `/api/reactions?bill=${bill}&client=${b}`));
  check("GET reflects the other client's own reaction", mine.like === 1 && mine.mine === "like");
  const batch = await body(await hit("GET /api/reactions", "ok", `/api/reactions?bills=${bill},118-hr-10,bad%20id&client=${b}`));
  check("GET ?bills= batch returns each valid bill and skips invalid ids", Object.keys(batch.reactions).sort().join() === `118-hr-10,${bill}` && batch.reactions[bill].mine === "like");
  const badR = await hit("POST /api/reactions", "err", "/api/reactions", post({ bill, client: a, reaction: "meh" }));
  check("invalid reaction → 400 with the allowed values", badR.status === 400 && (await body(badR)).error === "reaction must be like, dislike, or neutral");
  const badBill = await hit("POST /api/reactions", "err", "/api/reactions", post({ bill: "bad id!", client: a, reaction: "like" }));
  check("invalid bill id → 400", badBill.status === 400 && (await body(badBill)).error === "invalid bill id");
  const badClient = await hit("POST /api/reactions", "err", "/api/reactions", post({ bill, client: "x", reaction: "like" }));
  check("invalid client id → 400", badClient.status === 400 && (await body(badClient)).error === "invalid client id");
  const getBad = await hit("GET /api/reactions", "err", "/api/reactions?bill=bad%20id!");
  check("GET /api/reactions with a bad bill id → 400", getBad.status === 400 && (await body(getBad)).error === "invalid bill id");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Unknown routes, security headers, errors");
{
  const nf = await app.request("/api/does-not-exist");
  check("unknown /api/x → JSON 404 {error:'not found'}, no-store", nf.status === 404 && (await body(nf)).error === "not found" && cacheControl(nf) === "no-store");
  const nf2 = await app.request("/api/ny/nope");
  check("unknown nested /api path → same JSON 404", nf2.status === 404 && (await body(nf2)).error === "not found");
  const wrongMethod = await app.request("/api/members", { method: "DELETE" });
  check("a method with no route → JSON 404 (not a crash)", wrongMethod.status === 404);
  check("isApiPath: /api* and /healthz only", isApiPath("/api/x") && isApiPath("/healthz") && !isApiPath("/home.html") && !isApiPath("/"));

  // Security headers on EVERY app response: success, 4xx, 404, 304, 429 and 500.
  const samples: [string, Response][] = [
    ["200", await app.request("/api/latest")],
    ["400", await app.request("/api/profile?bioguide=bad!")],
    ["404", nf],
    ["304", await app.request("/api/members", { headers: { "If-None-Match": (await app.request("/api/members")).headers.get("ETag")! } })],
    ["healthz", await app.request("/healthz")],
  ];
  const brokenStore: Store = { get: async () => { throw new Error("kv exploded: secret-detail"); }, put: async () => {}, incr: async () => 0 };
  const brokenApp = createApp(makeDeps(brokenStore));
  errorLog = [];
  const fiveHundred = await brokenApp.request("/api/comments?bill=118-hr-1");
  samples.push(["500", fiveHundred]);
  for (let i = 0; i < 21; i++) await app.request("/api/comments", post({}, "rl-sec-headers"));
  const limitedRes = await app.request("/api/comments", post({}, "rl-sec-headers"));
  samples.push(["429", limitedRes]);
  for (const [label, res] of samples) {
    const missing = Object.entries(SECURITY_HEADERS).filter(([k, v]) => res.headers.get(k) !== v).map(([k]) => k);
    check(`security headers present and exact on a ${label} response`, missing.length === 0);
  }
  check("CSP keeps the locked-down directives (object-src 'none', frame-ancestors 'self', base-uri 'self')",
    ["object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "default-src 'self'"].every((d) => SECURITY_HEADERS["Content-Security-Policy"].includes(d)));

  // Static pages on Workers get their headers from apps/web/_headers — it must equal the constant.
  const headersFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "_headers"), "utf8");
  const parsed: Record<string, string> = {};
  for (const line of headersFile.split("\n")) { const m = line.match(/^\s+([A-Za-z-]+):\s*(.+?)\s*$/); if (m) parsed[m[1]] = m[2]; }
  check("apps/web/_headers matches the app's security headers exactly (same names, same values)",
    JSON.stringify(Object.entries(parsed).sort()) === JSON.stringify(Object.entries(SECURITY_HEADERS).sort()) && /^\/\*\s*$/m.test(headersFile));
  check("apps/web/_redirects rewrites / to /home.html (status 200)", /^\/\s+\/home\.html\s+200\s*$/m.test(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "_redirects"), "utf8")));

  // Errors: logged server-side with the detail; the client sees only the generic message.
  const fb = await fiveHundred.text();
  check("a store failure → generic 500 JSON {error:'internal server error'}", fiveHundred.status === 500 && JSON.parse(fb).error === "internal server error");
  check("…the response leaks no internal detail", !/kv exploded|secret-detail|Error:/.test(fb));
  check("…the real error + stack is logged server-side", errorLog.length >= 1 && String(errorLog[0][0]) === "[500]" && /kv exploded: secret-detail/.test(String(errorLog[0][3])));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Rate limiting (per client IP)");
{
  // POST /api/track allows 60 per minute per IP; the 61st is rejected with Retry-After.
  let last: Response = new Response();
  for (let i = 0; i < 60; i++) last = await app.request("/api/track", post({ kind: "bill", id: "rl-1" }, "rl-track-ip"));
  check("60 tracks from one IP are allowed", last.status === 200);
  const over = await app.request("/api/track", post({ kind: "bill", id: "rl-1" }, "rl-track-ip"));
  const ra = Number(over.headers.get("Retry-After"));
  check("the 61st → 429 with Retry-After seconds and the 'slow down' message",
    over.status === 429 && Number.isInteger(ra) && ra > 0 && ra <= 60 && /Too many requests/.test((await body(over)).error) && cacheControl(over) === "no-store");
  const other = await app.request("/api/track", post({ kind: "bill", id: "rl-1" }, "rl-other-ip"));
  check("limits are per client IP (another IP is unaffected)", other.status === 200);

  // Buckets are per route too: the comments limit (20) is separate from tracking.
  for (let i = 0; i < 20; i++) await app.request("/api/comments", post({ bill: "bad id!" }, "rl-comments-ip"));
  const c21 = await app.request("/api/comments", post({ bill: "bad id!" }, "rl-comments-ip"));
  check("POST /api/comments is capped at 20/min → 429 on the 21st (and the 429 comes before validation)", c21.status === 429 && c21.headers.has("Retry-After"));
  const stillTrack = await app.request("/api/track", post({ kind: "bill", id: "rl-2" }, "rl-comments-ip"));
  check("…while the same IP can still track (separate bucket)", stillTrack.status === 200);

  // The limiter and the IP come from the host: a stub limiter that always refuses must be honoured.
  const refusing = createApp({ ...makeDeps(), rateLimit: () => ({ ok: false, retryAfter: 7 }) });
  const refused = await refusing.request("/api/reactions", post({ bill: "118-hr-1", client: "client-zzzz-0001", reaction: "like" }));
  check("an injected limiter decides (retryAfter 7 → Retry-After: 7)", refused.status === 429 && refused.headers.get("Retry-After") === "7");
  let seenIp = "";
  const spying = createApp({ ...makeDeps(), rateLimit: (key) => { seenIp = key; return { ok: true, retryAfter: 0 }; } });
  await spying.request("/api/track", post({ kind: "bill", id: "x1" }, "203.0.113.9"));
  check("the injected clientIp feeds the bucket key ('track:203.0.113.9')", seenIp === "track:203.0.113.9");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Host-agnostic app code (decoupling rule 1)");
{
  const SRC = dirname(fileURLToPath(import.meta.url));
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  function reachable(entry: string): string[] {
    const seen = new Set<string>(); const stack = [join(SRC, entry)];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const m of stripComments(readFileSync(f, "utf8")).matchAll(/(?:from\s+|import\s*\(\s*)["'](\.[^"']+\.ts)["']/g)) stack.push(resolve(dirname(f), m[1]));
    }
    return [...seen];
  }
  for (const entry of ["app.ts", "worker.ts"]) {
    const files = reachable(entry);
    const offenders = files.flatMap((f) => {
      const code = stripComments(readFileSync(f, "utf8"));
      const hits = [/\bprocess\.(env|argv|exit|cwd|platform)/, /["']node:/, /\brequire\s*\(/, /\bfrom\s+["'](fs|path|url|http|os)["']/].filter((re) => re.test(code));
      return hits.length ? [f.slice(SRC.length + 1)] : [];
    });
    check(`nothing reachable from ${entry} uses process.env / node:* / require (${files.length} modules scanned)`, offenders.length === 0 && files.length > 20);
    if (offenders.length) console.log("    offenders: " + offenders.join(", "));
  }
  const configOnly = loadConfig({ CONGRESS_API_KEY: "  k  ", FEC_API_KEY: "   ", POCKETPOL_KV: { binding: true }, STRIPE_PRICE_PLUS: "price_1" });
  check("loadConfig trims values, drops blanks and non-string bindings (a Workers env is safe to pass whole)",
    configOnly.congress === "k" && configOnly.fec === undefined && configOnly.stripePrices.plus === "price_1" && !JSON.stringify(configOnly).includes("binding"));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
section("Route coverage");
{
  const VALIDATES = new Set([
    "GET /api/trending", "GET /api/profile", "GET /api/ny/bill", "GET /api/ny/transcript", "GET /api/cloture/vote",
    "GET /api/local/officials", "GET /api/state", "GET /api/money", "GET /api/donors", "GET /api/reps",
    "GET /api/v/:version/profile/:bioguide", "GET /api/comments", "POST /api/comments", "POST /api/translate",
    "POST /api/checkout", "GET /api/reactions", "POST /api/reactions",
  ]);
  /** Registered routes lacking an "ok" test (or an "err" test where input is validated). */
  function untested(target: App): string[] {
    const out: string[] = [];
    for (const r of target.routes) {
      if (r.method === "ALL") continue; // middleware (security headers) — covered by its own tests
      const key = `${r.method} ${r.path}`;
      const kinds = coverage.get(key);
      if (!kinds?.has("ok")) out.push(`${key} (no happy-path test)`);
      else if (VALIDATES.has(key) && !kinds.has("err")) out.push(`${key} (validates input but has no error test)`);
    }
    return out;
  }
  const missing = untested(app);
  check(`every one of the ${app.routes.filter((r) => r.method !== "ALL").length} registered routes has a test (and a validation-error test where it validates)`, missing.length === 0);
  if (missing.length) console.log("    untested: " + missing.join("; "));

  const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
  const stale = [...coverage.keys()].filter((k) => !registered.has(k));
  check("every route label in these tests exists on the app (no stale labels)", stale.length === 0);
  if (stale.length) console.log("    stale labels: " + stale.join("; "));
  check("every validating route in the VALIDATES list really exists", [...VALIDATES].every((k) => registered.has(k)));

  // Prove the check bites: a route added without a test must be reported.
  const probe = createApp(makeDeps());
  probe.get("/api/zz-untested", (c) => c.text("hi"));
  probe.post("/api/zz-also-untested", (c) => c.text("hi"));
  const probeMissing = untested(probe);
  check("the coverage check flags a new route that has no test",
    probeMissing.some((m) => m.startsWith("GET /api/zz-untested")) && probeMissing.some((m) => m.startsWith("POST /api/zz-also-untested")) && probeMissing.length === 2);
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────
console.error = realConsoleError;
console.log(`\n  ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error("  FAILED: " + fails.join(", ")); process.exit(1); }

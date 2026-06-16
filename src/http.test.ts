/**
 * Tests for the shared HTTP caching helpers. No test framework — runs under `tsx`
 * (`npm test`), asserts, and exits non-zero on failure. Uses the Web `Request`/`Response`
 * globals (Node 18+), the same primitives the Cloudflare Functions use.
 */
import { cacheControl, etagFor, jsonCached, jsonError, jsonImmutable, jsonPointer, DEFAULT_SMAXAGE } from "./http.ts";
import { dataVersion } from "./version.ts";
import { getProfile, getMembers, getBills, getBillVotes, clampLimit, isBioguide } from "./handlers.ts";
import { buildProfile } from "./profile.ts";
import { planSnapshot } from "./ingest.ts";
import { knapsack, selectToPregenerate, popularityValue } from "./optimize.ts";
import { MemoryStore, getStore, kvStore, readViews } from "./store.ts";
import type { ApiMember, ApiSponsored } from "./congress.ts";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name}`); }
}

// cacheControl
check("cacheControl has async SWR + stale-if-error",
  cacheControl().includes("stale-while-revalidate=86400") && cacheControl().includes("stale-if-error=86400"));
check("cacheControl uses default s-maxage", cacheControl().includes(`s-maxage=${DEFAULT_SMAXAGE}`));
check("cacheControl honors override", cacheControl(30).includes("s-maxage=30"));

// etagFor
check("etag is deterministic", etagFor('{"a":1}') === etagFor('{"a":1}'));
check("etag changes with content", etagFor('{"a":1}') !== etagFor('{"a":2}'));
check("etag is a weak tag", etagFor("x").startsWith('W/"'));

// jsonCached — basic
const r = jsonCached({ hello: "world" });
check("jsonCached status 200", r.status === 200);
check("jsonCached content-type json", r.headers.get("Content-Type") === "application/json");
check("jsonCached sets Cache-Control", (r.headers.get("Cache-Control") ?? "").includes("stale-while-revalidate"));
check("jsonCached sets ETag", !!r.headers.get("ETag"));

// jsonCached — 304 on matching If-None-Match
const body = { x: 1 };
const etag = etagFor(JSON.stringify(body));
const req = new Request("https://e/api/x", { headers: { "If-None-Match": etag } });
const notMod = jsonCached(body, { request: req });
check("jsonCached returns 304 on matching If-None-Match", notMod.status === 304);
check("304 echoes the ETag", notMod.headers.get("ETag") === etag);
check("304 still carries Cache-Control", (notMod.headers.get("Cache-Control") ?? "").includes("s-maxage"));

// jsonCached — non-matching INM serves full body
const req2 = new Request("https://e/api/x", { headers: { "If-None-Match": 'W/"deadbeef"' } });
check("jsonCached serves 200 on non-matching INM", jsonCached(body, { request: req2 }).status === 200);

// jsonError — never cached
const e = jsonError("nope", 502, { live: false });
check("jsonError carries the status", e.status === 502);
check("jsonError is no-store", e.headers.get("Cache-Control") === "no-store");

// jsonImmutable — cache forever
const im = jsonImmutable({ a: 1 });
check("jsonImmutable is immutable + 1yr", (im.headers.get("Cache-Control") ?? "") === "public, max-age=31536000, immutable");
check("jsonImmutable sets ETag", !!im.headers.get("ETag"));
const imEtag = etagFor(JSON.stringify({ a: 1 }));
const imReq = new Request("https://e/x", { headers: { "If-None-Match": imEtag } });
check("jsonImmutable 304 on matching INM", jsonImmutable({ a: 1 }, { request: imReq }).status === 304);

// jsonPointer — short-lived + SWR
const ptr = jsonPointer({ dataVersion: "abc" });
check("jsonPointer is short-lived + SWR", (ptr.headers.get("Cache-Control") ?? "").includes("stale-while-revalidate=300"));

// dataVersion — stable, hex, URL-safe
const v1 = dataVersion();
check("dataVersion is stable across calls", v1 === dataVersion());
check("dataVersion is hex (URL-safe segment)", /^[0-9a-f]+$/.test(v1));

// handlers — param helpers
check("clampLimit clamps high", clampLimit("9999", 20, 50) === 50);
check("clampLimit clamps negative to 1; garbage/0 → default", clampLimit("-5", 20, 50) === 1 && clampLimit("abc", 20, 50) === 20 && clampLimit("0", 20, 50) === 20);
check("isBioguide accepts O000172", isBioguide("O000172"));
check("isBioguide rejects junk", !isBioguide("nope") && !isBioguide("O00017"));

// handlers — fixture mode (no key) returns the contract shapes
const prof = await getProfile("O000172");
check("getProfile fixture: live false + note", prof.live === false && "note" in prof);
check("getProfile fixture: has bioguideId + record[]", "bioguideId" in prof && Array.isArray((prof as { record: unknown[] }).record));
const mem = await getMembers(250);
check("getMembers fixture: members[] + count matches", Array.isArray(mem.members) && mem.count === mem.members.length && mem.live === false);
const bil = await getBills(20);
check("getBills fixture: bills[] + count matches", Array.isArray(bil.bills) && bil.count === bil.bills.length && bil.live === false);
const votes = await getBillVotes(118, "hr", "1");
check("getBillVotes fixture: rollCalls + live false", Array.isArray(votes.rollCalls) && votes.live === false);
check("getBillVotes fixture: roll call has per-member positions + totals",
  votes.rollCalls[0].members.length > 0 && typeof votes.rollCalls[0].totals === "object" &&
  votes.rollCalls[0].members.every((m: { bioguideId: string; vote: string }) => !!m.bioguideId && !!m.vote));

// buildProfile — robust against real-world malformed sponsored entries (live-data regression)
const member = { bioguideId: "T000001", directOrderName: "Test Member", state: "NY" } as ApiMember;
const messy = [
  { type: "HR", number: "2664", congress: 117, title: "Clean Bill", introducedDate: "2021-04-19" },
  { type: null, number: undefined, congress: 116, title: undefined, introducedDate: "2020-07-30" }, // junk row that caused "null undefined"
  { type: "S", number: "100", congress: 118, title: "Has Title No Action", introducedDate: "2023-01-01" },
] as unknown as ApiSponsored[];
const built = buildProfile(member, messy);
check("buildProfile drops the titleless junk row", built.record.length === 2);
check("buildProfile never emits 'null'/'undefined' in id/title",
  built.record.every((r) => !/null|undefined/.test(r.id) && !/null|undefined/.test(r.title)));
check("buildProfile keeps the contract id format for clean bills",
  built.record.some((r) => r.id === "HR 2664 (117th)"));

// planSnapshot — the ingest plan (pure)
const snap = planSnapshot("abc123", { count: 2 }, { count: 3 }, [
  { bioguide: "O000172", data: { x: 1 } },
  { bioguide: "S000033", data: { x: 2 } },
]);
check("planSnapshot emits the pointer at api/latest", snap.some((f) => f.path === "api/latest"));
check("planSnapshot pointer carries the version",
  (snap.find((f) => f.path === "api/latest")?.body as { dataVersion: string })?.dataVersion === "abc123");
check("planSnapshot version-addresses members + bills",
  snap.some((f) => f.path === "api/v/abc123/members") && snap.some((f) => f.path === "api/v/abc123/bills"));
check("planSnapshot writes one profile file per member",
  snap.filter((f) => f.path.startsWith("api/v/abc123/profile/")).length === 2);
check("planSnapshot profile path uses the bioguide",
  snap.some((f) => f.path === "api/v/abc123/profile/O000172"));

// optimize — knapsack is EXACT DP, not naive greedy.
// Classic trap: greedy-by-value grabs A(60) and stops; the optimum is B+C(=100).
const ks = knapsack([
  { item: "A", value: 60, cost: 10 },
  { item: "B", value: 50, cost: 5 },
  { item: "C", value: 50, cost: 5 },
], 10);
check("knapsack finds the true optimum 100 (B+C), beating greedy A=60", ks.totalValue === 100);
check("knapsack chose exactly B and C", [...ks.chosen].sort().join("") === "BC");
check("knapsack never exceeds the budget", ks.totalCost <= 10);
check("knapsack zero budget → selects nothing", knapsack([{ item: "A", value: 5, cost: 1 }], 0).chosen.length === 0);

// selectToPregenerate — picks the highest-value members within the budget
const sm = [
  { bioguideId: "H1", chamber: "House of Representatives" },
  { bioguideId: "S1", chamber: "Senate" },
  { bioguideId: "H2", chamber: "House of Representatives" },
  { bioguideId: "S2", chamber: "Senate" },
];
const sel = selectToPregenerate(sm, 2);
check("selectToPregenerate respects the budget", sel.chosen.length === 2);
check("selectToPregenerate prefers higher-value members (proxy: Senate)", sel.chosen.every((m) => m.chamber === "Senate"));
check("selectToPregenerate honors real view data over the proxy",
  selectToPregenerate(sm, 1, { views: { H1: 1000 } }).chosen[0].bioguideId === "H1");

// popularityValue — real demand beats proxy; proxy ranks Senate over House
check("popularityValue uses real views when present", popularityValue({ bioguideId: "X" }, { X: 99 }) === 100);
check("popularityValue proxy: Senate > House",
  popularityValue({ bioguideId: "S", chamber: "Senate" }) > popularityValue({ bioguideId: "H", chamber: "House of Representatives" }));

// store — MemoryStore get/put/incr
const ms = new MemoryStore();
check("MemoryStore get missing → null", (await ms.get("nope")) === null);
await ms.put("k", "v");
check("MemoryStore put/get round-trips", (await ms.get("k")) === "v");
check("MemoryStore incr starts at 1", (await ms.incr("views:X")) === 1);
check("MemoryStore incr accumulates", (await ms.incr("views:X")) === 2);

// store — getStore graceful fallback (no binding → MemoryStore)
check("getStore() with no env → a working Store", (await getStore().incr("a")) === 1);

// store — kvStore adapter incr (read-modify-write over a fake KV)
const fakeKV = new Map<string, string>();
const kv = kvStore({
  get: async (k) => (fakeKV.has(k) ? fakeKV.get(k)! : null),
  put: async (k, v) => { fakeKV.set(k, v); },
});
check("kvStore incr 0→1", (await kv.incr("views:Y")) === 1);
check("kvStore incr 1→2", (await kv.incr("views:Y")) === 2);

// store + optimizer — real views drive the selection
const vstore = new MemoryStore();
await vstore.incr("views:H1"); await vstore.incr("views:H1"); await vstore.incr("views:H1"); // H1 popular
const views = await readViews(vstore, ["H1", "S1"]);
check("readViews returns recorded counts", views.H1 === 3);
const demandSel = selectToPregenerate(
  [{ bioguideId: "H1", chamber: "House of Representatives" }, { bioguideId: "S1", chamber: "Senate" }],
  1, { views });
check("optimizer picks the high-traffic member over the proxy default", demandSel.chosen[0].bioguideId === "H1");

// comments — add/get over a Store + validation
const { getComments, addComment, validBillId } = await import("./comments.ts");
const cstore = new MemoryStore();
check("comments empty initially", (await getComments(cstore, "118-hr-1")).length === 0);
const valid = { author: "Rene", district: "14", email: "rene@example.com", text: "Strongly support this." };
const after = await addComment(cstore, "118-hr-1", valid);
check("addComment returns the list with the new comment", after.length === 1 && after[0].text === "Strongly support this.");
check("addComment stores district + starts unverified", after[0].district === "14" && after[0].verified === false);
check("addComment keeps email PRIVATE (not in public list)", !("email" in after[0]));
check("addComment newest-first", (await getComments(cstore, "118-hr-1"))[0].author === "Rene");
const rejects = async (c: object) => { try { await addComment(cstore, "118-hr-1", c as any); return false; } catch { return true; } };
check("addComment requires a name", await rejects({ ...valid, author: "" }));
check("addComment requires a district", await rejects({ ...valid, district: "" }));
check("addComment requires a valid email", await rejects({ ...valid, email: "not-an-email" }));
check("addComment rejects empty text", await rejects({ ...valid, text: "   " }));
check("validBillId accepts 118-hr-1, rejects junk", validBillId("118-hr-1") && !validBillId("../etc"));

// money — fixture mode (no FEC key) returns demo totals
const { getMoney } = await import("./money.ts");
const money = await getMoney("O000172");
check("getMoney fixture: live false + note + totals", money.live === false && !!money.note && !!money.totals);
check("getMoney fixture: totals have raised/spent/cashOnHand",
  typeof money.totals!.raised === "number" && typeof money.totals!.spent === "number" && typeof money.totals!.cashOnHand === "number");
check("getMoney echoes the requested bioguide", money.bioguide === "O000172");

// config — integrations registry (secrets-safe status, never exposes values)
const { integrations, keySummary } = await import("./config.ts");
const intg = integrations();
const ids = intg.map(i => i.id);
check("integrations lists congress, fec, lda, nyOpenLeg",
  ["congress", "fec", "lda", "nyOpenLeg"].every(id => ids.includes(id)));
check("integrations entries are secrets-safe (no value field)",
  intg.every(i => !("value" in i) && typeof i.configured === "boolean" && !!i.signup));
check("keySummary marks each id with ✓/✗ and never leaks a key",
  /congress[✓✗]/.test(keySummary()) && !/=/.test(keySummary()));

// lobbying — fixture mode (no LDA key) returns the bundled real sample, clearly marked
const { getLobbying, LDA_SEARCH_URL } = await import("./lobbying.ts");
const lob = await getLobbying("Lower Energy Costs");
check("getLobbying fixture: live false + demo note", lob.live === false && /demo/i.test(lob.note ?? ""));
check("getLobbying fixture: has filings with registrant→client→issue",
  lob.filings.length > 0 && lob.filings.every(f => "registrant" in f && "client" in f && "issue" in f));
check("getLobbying always exposes the official LDA search url", lob.searchUrl === LDA_SEARCH_URL);
check("getLobbying never fuses lobbying with money (guidance says separate)", /separate/i.test(lob.guidance));
const lobEmpty = await getLobbying("");
check("getLobbying with no query returns no filings + a prompt", lobEmpty.filings.length === 0 && !!lobEmpty.note);

// NY state legislation — fixture mode + session math
const { getNyBills, nySession } = await import("./nystate.ts");
check("nySession maps even year to the odd session start", nySession(2026) === 2025 && nySession(2025) === 2025);
const ny = await getNyBills(10);
check("getNyBills fixture: live false + demo note", ny.live === false && /demo/i.test(ny.note ?? ""));
check("getNyBills fixture: bills have printNo, sponsor, official url",
  ny.bills.length > 0 && ny.bills.every(b => !!b.printNo && "sponsor" in b && /nysenate\.gov/.test(b.url)));
const { getNyLaws, getNyTranscripts, getNyCalendars, getNyAgendas } = await import("./nystate.ts");
const nyc = await getNyCalendars();
check("getNyCalendars fixture: entries have calendarNumber + calDate", nyc.calendars.length > 0 && nyc.calendars.every(c => c.calendarNumber != null && "calDate" in c));
const nyag = await getNyAgendas();
check("getNyAgendas fixture: entries have number + weekOf", nyag.agendas.length > 0 && nyag.agendas.every(a => a.number != null && "weekOf" in a));
const nyl = await getNyLaws();
check("getNyLaws fixture: laws have lawId, name, official url",
  nyl.laws.length > 0 && nyl.laws.every(l => !!l.lawId && !!l.name && /nysenate\.gov\/legislation\/laws/.test(l.url)));
const nyt = await getNyTranscripts();
check("getNyTranscripts fixture: entries have dateTime + url",
  nyt.transcripts.length > 0 && nyt.transcripts.every(t => !!t.dateTime && !!t.url));

// OpenStates — all-50-states, fixture mode
const { getStateData } = await import("./openstates.ts");
const sd = await getStateData("North Dakota");
check("getStateData fixture: live false + demo note", sd.live === false && /demo/i.test(sd.note ?? ""));
check("getStateData fixture: legislators have name + chamber, bills have identifier",
  sd.legislators.length > 0 && sd.legislators.every(l => !!l.name && "chamber" in l)
  && sd.bills.length > 0 && sd.bills.every(b => !!b.identifier));

// Congressional calendar — fixture mode
const { getCalendar, OFFICIAL_CALENDARS } = await import("./calendar.ts");
const cal = await getCalendar();
check("getCalendar fixture: live false + demo note", cal.live === false && /demo/i.test(cal.note ?? ""));
check("getCalendar fixture: meetings have title/date/committee", cal.meetings.length > 0 && cal.meetings.every(m => "title" in m && "date" in m));
check("OFFICIAL_CALENDARS lists authoritative House/Senate schedules",
  OFFICIAL_CALENDARS.length >= 3 && OFFICIAL_CALENDARS.every(o => /^https:\/\//.test(o.url)));

// Budget watch — fixture mode + official trackers
const { getBudgetWatch, OFFICIAL_BUDGET } = await import("./budget.ts");
const bud = await getBudgetWatch();
check("getBudgetWatch fixture: live false + demo note", bud.live === false && /demo/i.test(bud.note ?? ""));
check("getBudgetWatch always includes the authoritative status table",
  OFFICIAL_BUDGET.some(o => /Appropriations Status Table/i.test(o.name)) && bud.official.length >= 3);
check("getBudgetWatch appropriations entries have type/number/url",
  bud.appropriations.every(b => !!b.type && !!b.number && /congress\.gov/.test(b.url)));

// Payments (Stripe) — pure helpers, no network
const { buildCheckoutForm, paymentsConfigured, createCheckout, tiersPublic } = await import("./payments.ts");
check("paymentsConfigured reflects the secret key", !paymentsConfigured(undefined) && paymentsConfigured("sk_test_x"));
check("tiersPublic exposes tiers without the priceEnv secret-ish field",
  tiersPublic().length >= 3 && tiersPublic().every(t => !("priceEnv" in t) && !!t.id && !!t.price));
const form = buildCheckoutForm("price_123", "subscription", "https://x/ok", "https://x/no");
const fp = new URLSearchParams(form);
check("buildCheckoutForm encodes price/mode/urls correctly",
  fp.get("line_items[0][price]") === "price_123" && fp.get("mode") === "subscription" && fp.get("success_url") === "https://x/ok");
check("createCheckout without a key returns a clean not-configured error",
  /not configured/i.test((await createCheckout("plus", "http://x", undefined)).error ?? ""));
check("createCheckout rejects an unknown plan", /unknown plan/i.test((await createCheckout("bogus", "http://x", "sk_test_x")).error ?? ""));
check("createCheckout flags a missing price id (no network call)",
  /STRIPE_PRICE_PLUS/.test((await createCheckout("plus", "http://x", "sk_test_x")).error ?? ""));

// Filibuster / cloture — validate the captured fixture shape (no network)
{
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cloture.json");
  const clo = JSON.parse(await readFile(p, "utf8"));
  check("cloture fixture: votes carry result/invoked/tally",
    clo.votes.length > 0 && clo.votes.every((v: any) => "invoked" in v && typeof v.yeas === "number" && !!v.result));
  check("cloture fixture: total = invoked + blocked", clo.total === clo.invoked + clo.blocked);
}

// Security — state param allowlist (no upstream-URL injection)
const { isValidState } = await import("./openstates.ts");
check("isValidState accepts real states", isValidState("California") && isValidState("New York"));
check("isValidState rejects junk / injection attempts",
  !isValidState("../etc/passwd") && !isValidState("California&jurisdiction=x") && !isValidState("") && !isValidState("Atlantis"));

// Bill translator (AI) — pure body builder + cost caps + cleanly-disabled no-key path
const { buildBody, getTranslation, MODEL } = await import("./translate.ts");
const txBody = JSON.parse(buildBody("x".repeat(99999)));
check("translate buildBody sets model + capped max_tokens", txBody.model === MODEL && txBody.max_tokens <= 1024);
check("translate buildBody caps the input length sent", txBody.messages[0].content.length < 7000);
const tstore = new MemoryStore();
const noKey = await getTranslation("119-hr-1", "some bill text", undefined, tstore);
check("getTranslation without a key is cleanly disabled (no fabrication)", noKey.enabled === false && /ANTHROPIC_API_KEY/.test(noKey.note ?? ""));

// Comment moderation — rules-based spam/promo/nonsense filter (no key)
const { moderate } = await import("./moderation.ts");
check("moderate accepts a real on-topic comment", moderate("I support this bill — it helps families in my district.").ok);
check("moderate rejects links / promotion",
  !moderate("Check out www.mysite.com for deals").ok && !moderate("BUY NOW discount click here").ok);
check("moderate rejects phone numbers + all-caps + nonsense",
  !moderate("call me at 555-123-4567").ok && !moderate("THIS IS COMPLETELY UNACCEPTABLE NONSENSE").ok && !moderate("!!!!!!!!!!!!!!!").ok);
// integration: a promo comment is blocked at post time
const modStore = new MemoryStore();
let blocked = false;
try { await addComment(modStore, "119-hr-1", { author: "X", district: "1", email: "x@y.com", text: "buy bitcoin now www.scam.io" }); }
catch { blocked = true; }
check("addComment blocks a promo/link comment via moderation", blocked);

// Rate limiter — protects the paid AI endpoint + write spam
const { rateLimit } = await import("./ratelimit.ts");
const rlKey = "t-" + Math.random();
let allowed = true; for (let i = 0; i < 5; i++) allowed = allowed && rateLimit(rlKey, 5, 60_000).ok;
check("rateLimit allows up to the cap", allowed);
const over = rateLimit(rlKey, 5, 60_000);
check("rateLimit rejects past the cap with a retryAfter", !over.ok && over.retryAfter > 0);

// Trending — the "observe engagement" surface (#39)
const { track, getTrending } = await import("./trending.ts");
const trStore = new MemoryStore();
await track(trStore, "bill", "119-hr-1", "HR 1"); await track(trStore, "bill", "119-hr-1"); await track(trStore, "bill", "119-s-5", "S 5");
const top = await getTrending(trStore, "bill", 5);
check("trending ranks by count and keeps the label", top[0].id === "119-hr-1" && top[0].count === 2 && top[0].label === "HR 1");
check("trending rejects bad kind/id (no key-listing leak)", (await getTrending(trStore, "bogus")).length === 0 && (await (async () => { await track(trStore, "bill", "../x"); return getTrending(trStore, "bill", 20); })()).every(i => i.id !== "../x"));

// summary
console.log(`\n  ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error("  FAILED: " + fails.join(", ")); process.exit(1); }

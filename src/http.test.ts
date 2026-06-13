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

// summary
console.log(`\n  ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error("  FAILED: " + fails.join(", ")); process.exit(1); }

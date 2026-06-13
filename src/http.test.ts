/**
 * Tests for the shared HTTP caching helpers. No test framework — runs under `tsx`
 * (`npm test`), asserts, and exits non-zero on failure. Uses the Web `Request`/`Response`
 * globals (Node 18+), the same primitives the Cloudflare Functions use.
 */
import { cacheControl, etagFor, jsonCached, jsonError, jsonImmutable, jsonPointer, DEFAULT_SMAXAGE } from "./http.ts";
import { dataVersion } from "./version.ts";
import { getProfile, getMembers, getBills, clampLimit, isBioguide } from "./handlers.ts";
import { buildProfile } from "./profile.ts";
import { planSnapshot } from "./ingest.ts";
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

// summary
console.log(`\n  ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error("  FAILED: " + fails.join(", ")); process.exit(1); }

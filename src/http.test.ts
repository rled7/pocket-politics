/**
 * Tests for the shared HTTP caching helpers. No test framework — runs under `tsx`
 * (`npm test`), asserts, and exits non-zero on failure. Uses the Web `Request`/`Response`
 * globals (Node 18+), the same primitives the Cloudflare Functions use.
 */
import { cacheControl, etagFor, jsonCached, jsonError, DEFAULT_SMAXAGE } from "./http.ts";

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

// summary
console.log(`\n  ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error("  FAILED: " + fails.join(", ")); process.exit(1); }

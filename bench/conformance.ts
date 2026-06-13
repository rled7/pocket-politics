/**
 * Conformance gate — does a backend produce the SAME JSON as the TypeScript reference?
 * Compares the running backend at $BASE (default the Rust server on :8787) against the TS
 * data layer, semantically (order-independent, ignoring the volatile `generatedAt`). A
 * backend must pass this before its benchmark numbers count (API_CONTRACT.md §Conformance).
 *
 *   RUST: cargo run --release  (in rust/)   then:   BASE=http://localhost:8787 npx tsx bench/conformance.ts
 */
import { getMembers, getBills, getProfile } from "../src/handlers.ts";

const BASE = process.env.BASE ?? "http://localhost:8787";

// Order-independent normalization; drop time-based fields that legitimately differ per run.
function stable(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(stable);
  if (o && typeof o === "object") {
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(o as object).sort()) {
      if (k === "generatedAt") continue;
      r[k] = stable((o as Record<string, unknown>)[k]);
    }
    return r;
  }
  return o;
}
const norm = (o: unknown) => JSON.stringify(stable(o));

let pass = 0;
const fails: string[] = [];
async function compare(name: string, tsData: unknown, path: string) {
  const res = await fetch(BASE + path);
  const rustData = await res.json();
  if (norm(tsData) === norm(rustData)) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fails.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    TS  : ${norm(tsData).slice(0, 200)}`);
    console.log(`    Rust: ${norm(rustData).slice(0, 200)}`);
  }
}

(async () => {
  console.log(`\n  Conformance: TypeScript reference  vs  ${BASE}\n  ${"-".repeat(56)}`);
  await compare("/api/members", await getMembers(250), "/api/members");
  await compare("/api/bills", await getBills(20), "/api/bills");
  await compare("/api/profile?bioguide=O000172", await getProfile("O000172"), "/api/profile?bioguide=O000172");

  // /api/latest: shape only (dataVersion is a per-backend stamp, not required to match).
  const latest = await (await fetch(BASE + "/api/latest")).json();
  if (typeof latest.dataVersion === "string" && /^[0-9a-f]+$/.test(latest.dataVersion)) {
    pass++; console.log("  ✓ /api/latest (hex dataVersion present)");
  } else { fails.push("/api/latest"); console.log("  ✗ /api/latest"); }

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.error("  CONFORMANCE FAILED: " + fails.join(", ")); process.exit(1); }
  console.log("  ✅ backend conforms to the TypeScript reference\n");
})();

/**
 * Phase 0 demo runner.
 *   npm run demo        → builds a profile from the offline fixture (no key/network)
 *   npm run demo:live   → pulls a REAL member from Congress.gov (needs CONGRESS_API_KEY)
 *
 * Writes web/profile.json (consumed by the web viewer) and prints a summary.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProfile, type Profile } from "./profile.ts";
import { fetchMember, fetchSponsored } from "./congress.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const useLive = process.env.USE_LIVE === "1";
const KEY = process.env.CONGRESS_API_KEY ?? "";
// Default live target: a sitting member's bioguideId (override with BIOGUIDE=...)
const BIOGUIDE = process.env.BIOGUIDE ?? "O000172";

async function load(): Promise<Profile> {
  if (useLive) {
    if (!KEY) throw new Error("USE_LIVE=1 but CONGRESS_API_KEY is not set. Get a free key: https://api.congress.gov/sign-up/");
    console.log(`→ Live: fetching ${BIOGUIDE} from Congress.gov…`);
    const [member, sponsored] = await Promise.all([fetchMember(BIOGUIDE, KEY), fetchSponsored(BIOGUIDE, KEY)]);
    return buildProfile(member, sponsored);
  }
  console.log("→ Offline: building from fixtures/ (run with `npm run demo:live` for real data)");
  const member = JSON.parse(await readFile(join(root, "fixtures/member.json"), "utf8"));
  const sponsored = JSON.parse(await readFile(join(root, "fixtures/sponsored.json"), "utf8"));
  return buildProfile(member, sponsored);
}

const profile = await load();
await mkdir(join(root, "web"), { recursive: true });
await writeFile(join(root, "web/profile.json"), JSON.stringify(profile, null, 2));

console.log("\n  ───────────────────────────────────────────");
console.log(`  ${profile.name}`);
console.log(`  ${profile.party} · ${profile.state} · ${profile.chamber}`);
console.log(`  ───────────────────────────────────────────`);
console.log(`  Legislative record (sponsored): ${profile.record.length} items\n`);
for (const r of profile.record) console.log(`   • ${r.date}  ${r.id}\n     ${r.title}`);
console.log(`\n  Source: ${profile.sources.join("; ")}`);
console.log("  → wrote web/profile.json   (run `npm run serve` to view)\n");

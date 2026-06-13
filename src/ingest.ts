/**
 * Ingest job — the "runs once" backend (CACHING_ARCHITECTURE.md L4 + L0).
 *
 * Pulls data through the shared data layer, stamps a dataVersion, and writes a STATIC
 * snapshot tree any CDN / object store can serve with ZERO compute (L0). This is what makes
 * the hot path lag-free: reads hit pre-generated files, never a Function.
 *
 *   npx tsx src/ingest.ts                       # fixtures (deterministic, no network)
 *   CONGRESS_API_KEY=… npx tsx src/ingest.ts     # live (real Congress.gov data)
 *
 * Output: dist/  (gitignored build artifact)
 *   dist/api/latest                               → { dataVersion }
 *   dist/api/v/{version}/members
 *   dist/api/v/{version}/bills
 *   dist/api/v/{version}/profile/{bioguide}       (one per top-N member)
 *
 * Provider-agnostic: copy dist/api into the Cloudflare Pages output, or push it to object
 * storage (R2 / S3 / Bunny) for the persistent server. Same bytes either way.
 */
import { writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { getProfile, getMembers, getBills } from "./handlers.ts";
import { selectToPregenerate, type ScorableMember } from "./optimize.ts";
import { getStore, readViews } from "./store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Pre-generation budget: how many profiles we can afford to bake (API/storage). The
 *  optimizer (src/optimize.ts) picks the BEST set within this budget, not an arbitrary slice. */
const PREGEN_BUDGET = Number(process.env.PREGEN_BUDGET ?? 8);

export interface SnapshotFile {
  path: string; // relative to the output root, e.g. "api/v/abc/members"
  body: unknown;
}

/**
 * Pure: given the ingested pieces, decide exactly which files to write. No IO, so it's
 * unit-testable and the IO wrapper stays trivial.
 */
export function planSnapshot(
  version: string,
  members: unknown,
  bills: unknown,
  profiles: { bioguide: string; data: unknown }[],
): SnapshotFile[] {
  const base = `api/v/${version}`;
  return [
    { path: "api/latest", body: { dataVersion: version } },
    { path: `${base}/members`, body: members },
    { path: `${base}/bills`, body: bills },
    ...profiles.map((p) => ({ path: `${base}/profile/${p.bioguide}`, body: p.data })),
  ];
}

/** Run `fn` over items with at most `limit` in flight at once (bounded concurrency). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Derive a version for this snapshot: a content hash so identical data → identical version. */
function versionFor(payload: unknown): string {
  const s = JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

async function main(): Promise<void> {
  const key = process.env.CONGRESS_API_KEY || undefined;
  console.log(`→ Ingest (${key ? "LIVE Congress.gov" : "fixtures"})…`);

  const [members, bills] = await Promise.all([getMembers(250, key), getBills(50, key)]);

  // OPTIMIZATION: instead of an arbitrary "first N", pick the set of profiles that maximizes
  // expected cache hits within PREGEN_BUDGET (0/1 knapsack — see src/optimize.ts). With real
  // view counts this becomes demand-driven; for now it uses a transparent popularity proxy.
  const directory = ((members as { members: ScorableMember[] }).members ?? []).filter((m) => m.bioguideId);
  // Demand-driven: read real view counts from the store (KV in prod; empty locally → proxy).
  const views = await readViews(getStore(), directory.map((m) => m.bioguideId));
  const selection = selectToPregenerate(directory, PREGEN_BUDGET, { views });
  console.log(`  optimizer: baking ${selection.chosen.length}/${directory.length} profiles ` +
    `(budget ${PREGEN_BUDGET}, expected-value ${selection.totalValue})`);

  // Fetch the chosen profiles with bounded concurrency (not one-at-a-time) — ~Nx faster
  // ingest while staying polite to the gov API.
  const profiles = await mapLimit(selection.chosen, 6, async (m) => ({
    bioguide: m.bioguideId,
    data: await getProfile(m.bioguideId, key),
  }));

  const version = versionFor({ members, bills, profiles });
  const files = planSnapshot(version, members, bills, profiles);

  const out = join(root, "dist");
  await rm(out, { recursive: true, force: true });
  for (const f of files) {
    const full = join(out, f.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(f.body));
  }

  console.log(`  dataVersion = ${version}`);
  console.log(`  wrote ${files.length} static files → dist/`);
  console.log(`  ${profiles.length} profiles, ${(bills as { count: number }).count} bills, ` +
    `${(members as { count: number }).count} members`);
  console.log(`  serve dist/ behind a CDN, or copy dist/api into the Pages output.`);
}

// Only run the job when executed directly (so tests can import planSnapshot without ingesting).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("Ingest failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

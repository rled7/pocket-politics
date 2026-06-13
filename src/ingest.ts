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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Top-N member profiles to pre-generate (capped to stay well under gov API rate limits). */
const TOP_N = 8;

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

  // Pre-generate profiles for the first TOP_N members in the directory.
  const ids = ((members as { members: { bioguideId: string }[] }).members ?? [])
    .map((m) => m.bioguideId)
    .filter(Boolean)
    .slice(0, TOP_N);
  const profiles: { bioguide: string; data: unknown }[] = [];
  for (const bioguide of ids) {
    profiles.push({ bioguide, data: await getProfile(bioguide, key) });
  }

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

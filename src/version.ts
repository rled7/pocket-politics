/**
 * `dataVersion` — the single stamp that powers the version-pointer scheme
 * (CACHING_ARCHITECTURE.md §4). Clients fetch the tiny mutable pointer `/api/latest`, learn
 * the current version, then fetch IMMUTABLE payloads at `/api/v/{dataVersion}/...` which can
 * be cached forever. That is how mutable civic data gets immutable caching.
 *
 * In fixture mode the version is a stable hash of the bundled data (changes only when the
 * data changes). When the Cron ingest job lands, it will stamp a monotonic version per
 * refresh instead — same contract, the pointer just starts moving.
 */
import { etagFor } from "./http.ts";
import memberFixture from "../fixtures/member.json";
import sponsoredFixture from "../fixtures/sponsored.json";
import membersFixture from "../fixtures/members.json";
import billsFixture from "../fixtures/bills.json";

let cached: string | null = null;

export function dataVersion(): string {
  if (cached) return cached;
  const blob = JSON.stringify([memberFixture, sponsoredFixture, membersFixture, billsFixture]);
  // etagFor → W/"<hex>"; keep just the hex so the version is a clean URL segment.
  cached = etagFor(blob).replace(/[^0-9a-f]/gi, "");
  return cached;
}

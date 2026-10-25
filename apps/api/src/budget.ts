/**
 * Budget & shutdown watch — appropriations bills currently in Congress + authoritative status.
 *
 * HONESTY: there is no clean API field for "days until a shutdown," and scanning the bill feed for
 * appropriations is sparse (verified: ~2-3 real approps bills in 250 recent, 0 CRs). So we DON'T
 * fake a countdown. We surface (a) the appropriations bills we can actually find, clearly labeled,
 * and (b) the authoritative Appropriations Status Table + committee trackers, which ARE the source
 * of truth for where funding stands. Plus a plain explainer of how a shutdown happens.
 */

const API = "https://api.congress.gov/v3";
const UA = { "User-Agent": "PocketPolitics/0.1 (civic transparency)" };
const SLUG: Record<string, string> = {
  HR: "house-bill", S: "senate-bill", HJRES: "house-joint-resolution", SJRES: "senate-joint-resolution",
  HCONRES: "house-concurrent-resolution", SCONRES: "senate-concurrent-resolution",
};

export interface AppropBill {
  type: string; number: string; title: string;
  latestAction?: string | null; actionDate?: string | null; url: string;
}
export interface BudgetResult {
  congress: number; source: string; live: boolean; note?: string;
  appropriations: AppropBill[]; official: { name: string; url: string }[];
}

/** Authoritative trackers — always accurate, the real source of truth for funding status. */
export const OFFICIAL_BUDGET = [
  { name: "Appropriations Status Table (Congress.gov)", url: "https://www.congress.gov/resources/display/content/Appropriations+Status+Table" },
  { name: "House Appropriations Committee", url: "https://appropriations.house.gov/" },
  { name: "Senate Appropriations Committee", url: "https://www.appropriations.senate.gov/" },
  { name: "Congressional Budget Office (CBO)", url: "https://www.cbo.gov/" },
];

function billUrl(type: string, number: string | number, congress: number): string {
  return `https://www.congress.gov/bill/${congress}th-congress/${SLUG[(type || "").toUpperCase()] ?? "house-bill"}/${number}`;
}
function isAppropriations(title: string): boolean {
  const t = (title || "").toLowerCase();
  return t.includes("appropriations") && !t.includes("disapprov");
}

export async function getBudgetWatch(key?: string, congress = 119): Promise<BudgetResult> {
  const base: BudgetResult = { congress, source: "Congress.gov", live: false, appropriations: [], official: OFFICIAL_BUDGET };
  if (key) {
    try {
      const res = await fetch(`${API}/bill/${congress}?limit=250&sort=updateDate+desc&api_key=${encodeURIComponent(key)}&format=json`, { headers: UA });
      if (!res.ok) throw new Error(`Congress.gov ${res.status}`);
      const d: any = await res.json();
      const appropriations: AppropBill[] = (d?.bills ?? [])
        .filter((b: any) => isAppropriations(b?.title))
        .map((b: any) => ({
          type: b?.type, number: String(b?.number), title: (b?.title ?? "").trim(),
          latestAction: b?.latestAction?.text ?? null, actionDate: b?.latestAction?.actionDate ?? null,
          url: billUrl(b?.type, b?.number, congress),
        }));
      return { ...base, live: true, appropriations };
    } catch (e) {
      return { ...base, note: `Live appropriations lookup unavailable (${e instanceof Error ? e.message : "error"}).` };
    }
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "budget.json");
    const fx = JSON.parse(await readFile(path, "utf8")) as { appropriations: AppropBill[] };
    return { ...base, appropriations: fx.appropriations, note: "Demo data — set CONGRESS_API_KEY for live appropriations bills." };
  } catch {
    return { ...base, note: "Demo data unavailable. Set CONGRESS_API_KEY for live appropriations bills." };
  }
}

/**
 * Congressional Record — the official daily record of what's said/done on the House & Senate floors
 * (Congress.gov `daily-congressional-record`). This is the FEDERAL parallel to the NY Senate transcripts
 * (#32). We surface daily issues + a link to the official record now; plain-language AI summaries
 * ("in lay terms") layer on via the translator once ANTHROPIC_API_KEY is set — same scaffold pattern.
 */
const API = "https://api.congress.gov/v3";
const UA = { "User-Agent": "PocketPolitics/0.1 (civic transparency)" };

export interface RecordIssue {
  volume: number; issue: string; date: string | null; session?: number; congress?: number; url: string;
}
export interface RecordResult { source: string; live: boolean; note?: string; total?: number; issues: RecordIssue[]; }

const PUBLIC = "https://www.congress.gov/congressional-record";

export async function getRecord(limit = 14, key?: string): Promise<RecordResult> {
  const base: RecordResult = { source: "Congress.gov — daily Congressional Record", live: false, issues: [] };
  if (key) {
    try {
      const res = await fetch(`${API}/daily-congressional-record?limit=${Math.min(limit, 30)}&api_key=${encodeURIComponent(key)}&format=json`, { headers: UA });
      if (!res.ok) throw new Error(`Congress.gov ${res.status}`);
      const d: any = await res.json();
      const issues = (d?.dailyCongressionalRecord ?? []).map((x: any) => ({
        volume: x?.volumeNumber, issue: x?.issueNumber, date: x?.issueDate ?? null,
        session: x?.sessionNumber, congress: x?.congress, url: PUBLIC,
      }));
      return { ...base, live: true, total: d?.pagination?.count, issues };
    } catch (e) { return { ...base, note: `Live record unavailable (${e instanceof Error ? e.message : "error"}).` }; }
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record.json");
    const fx = JSON.parse(await readFile(path, "utf8")) as { total?: number; issues: RecordIssue[] };
    return { ...base, total: fx.total, issues: fx.issues, note: "Demo data — set CONGRESS_API_KEY for the live record." };
  } catch {
    return { ...base, note: "Demo data unavailable. Set CONGRESS_API_KEY for the live record." };
  }
}

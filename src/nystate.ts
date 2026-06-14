/**
 * New York State legislation — via the NY Senate Open Legislation API
 * (legislation.nysenate.gov/api/3, key as `?key=`). Verified live: the `/bills/{session}` list
 * returns 25k+ bills/session with sponsor, summary, status, and actions.
 *
 * This is the FIRST state-level data source — the template the rest of the per-state work
 * (#6/#25/#35) follows. Open Legislation also serves NY laws, session transcripts, committee
 * agendas, floor calendars, and member rosters — those are follow-on sections (#32/#33/#35).
 *
 * Honesty: NY data is New York only. We never imply it's national. Fixture fallback (a real
 * captured sample) keeps the page working with no key / offline.
 */

export interface NyBill {
  printNo: string;
  type: string;          // "Bill" | "Resolution"
  title: string;
  sponsor: string | null;
  summary?: string | null;
  status?: string | null;
  actionDate?: string | null;
  year?: number;
  url: string;           // official nysenate.gov bill page
}

export interface NyBillsResult {
  session: number;
  source: string;
  live: boolean;
  note?: string;
  total?: number;
  bills: NyBill[];
}

const API = "https://legislation.nysenate.gov/api/3";
const SOURCE = "NY Senate Open Legislation";

/** NY legislative sessions are 2-year and keyed to the odd start year (2025 covers 2025–26). */
export function nySession(year = new Date().getFullYear()): number {
  return year % 2 === 1 ? year : year - 1;
}

function mapBill(b: any): NyBill {
  const st = b?.status ?? {};
  const pn = b?.basePrintNo ?? b?.printNo;
  const session = b?.session ?? b?.year;
  return {
    printNo: pn,
    type: b?.billType?.resolution ? "Resolution" : "Bill",
    title: (b?.title ?? "").trim(),
    sponsor: b?.sponsor?.member?.fullName ?? null,
    summary: (b?.summary ?? "").trim().slice(0, 300) || null,
    status: st?.statusDesc ?? st?.statusType ?? null,
    actionDate: st?.actionDate ?? null,
    year: session,
    url: `https://www.nysenate.gov/legislation/bills/${session}/${pn}`,
  };
}

/** Live: recent NY bills, most-recent-action first. Throws on non-200 so callers can fall back. */
export async function fetchNyBills(limit: number, key: string, session = nySession()): Promise<{ total: number; bills: NyBill[] }> {
  const u = new URL(`${API}/bills/${session}`);
  u.searchParams.set("limit", String(Math.min(limit, 50)));
  u.searchParams.set("offset", "1");
  u.searchParams.set("sort", "status.actionDate:DESC");
  u.searchParams.set("key", key);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
  const d: any = await res.json();
  return { total: d?.total ?? 0, bills: (d?.result?.items ?? []).map(mapBill) };
}

/** NY bills with graceful fallback: live when keyed, else the bundled real fixture. */
export async function getNyBills(limit = 20, key?: string, session = nySession()): Promise<NyBillsResult> {
  const base: NyBillsResult = { session, source: SOURCE, live: false, bills: [] };
  if (key) {
    try {
      const { total, bills } = await fetchNyBills(limit, key, session);
      return { ...base, live: true, total, bills };
    } catch (e) {
      return { ...base, note: `Live NY lookup unavailable (${e instanceof Error ? e.message : "error"}).` };
    }
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ny_bills.json");
    const fx = JSON.parse(await readFile(path, "utf8")) as { session?: number; total?: number; bills: NyBill[] };
    return { ...base, session: fx.session ?? session, total: fx.total, bills: fx.bills, note: "Demo data — set NY_OPENLEG_API_KEY for live NY legislation." };
  } catch {
    return { ...base, note: "Demo data unavailable. Set NY_OPENLEG_API_KEY for live NY legislation." };
  }
}

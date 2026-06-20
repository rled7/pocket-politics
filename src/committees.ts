/**
 * Congressional committees + CRS reports — two untapped Congress.gov surfaces (#56).
 *
 * - **Committees** are where bills actually live and die ("referred to committee"). We list the full
 *   set for a Congress, grouped by chamber, nesting subcommittees under their parent.
 * - **CRS reports** are the Congressional Research Service's *nonpartisan, plain-language* analyses of
 *   policy issues — some of the most citizen-useful writing the government produces. We surface a recent
 *   feed linking to the official report.
 *
 * Both fetches are AbortSignal-timeout-guarded (Problem #001 lesson: a slow/120-down upstream must never
 * hang a request) and degrade to a clean "set CONGRESS_API_KEY" note rather than fabricating.
 */
const API = "https://api.congress.gov/v3";
const UA = { "User-Agent": "PocketPolitics/0.1 (civic transparency)" };
const TIMEOUT = 10_000;

export interface Committee {
  name: string; systemCode: string; chamber: string; url: string;
  subcommittees: { name: string; systemCode: string }[];
}
export interface CommitteesResult { source: string; live: boolean; note?: string; total?: number; committees: Committee[]; }

const PUBLIC_CMTE = "https://www.congress.gov/committees";

export async function getCommittees(key?: string, congress = 119): Promise<CommitteesResult> {
  const base: CommitteesResult = { source: "Congress.gov — committees", live: false, committees: [] };
  if (!key) return { ...base, note: "Set CONGRESS_API_KEY for live committees." };
  try {
    const res = await fetch(`${API}/committee/${congress}?limit=250&api_key=${encodeURIComponent(key)}&format=json`,
      { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`Congress.gov ${res.status}`);
    const d: any = await res.json();
    const rows: any[] = d?.committees ?? [];
    // Subcommittees carry a `parent`; top-level committees don't. Nest subs under their parent code.
    const parents = new Map<string, Committee>();
    const orphanSubs: any[] = [];
    for (const r of rows) {
      if (r?.parent?.systemCode) { orphanSubs.push(r); continue; }
      parents.set(r.systemCode, {
        name: r.name, systemCode: r.systemCode, chamber: r.chamber ?? "—",
        url: PUBLIC_CMTE, subcommittees: [],
      });
    }
    for (const s of orphanSubs) {
      const p = parents.get(s.parent.systemCode);
      if (p) p.subcommittees.push({ name: s.name, systemCode: s.systemCode });
    }
    const committees = [...parents.values()].sort((a, b) =>
      a.chamber === b.chamber ? a.name.localeCompare(b.name) : a.chamber.localeCompare(b.chamber));
    return { ...base, live: true, total: d?.pagination?.count, committees };
  } catch (e) { return { ...base, note: `Live committees unavailable (${e instanceof Error ? e.message : "error"}).` }; }
}

export interface CrsReport { id: string; title: string; publishDate: string | null; contentType?: string; url: string; }
export interface CrsResult { source: string; live: boolean; note?: string; total?: number; reports: CrsReport[]; }

const PUBLIC_CRS = "https://www.congress.gov/crs-products";

export async function getCrsReports(key?: string, limit = 20): Promise<CrsResult> {
  const base: CrsResult = { source: "Congress.gov — CRS reports (nonpartisan)", live: false, reports: [] };
  if (!key) return { ...base, note: "Set CONGRESS_API_KEY for live CRS reports." };
  try {
    const res = await fetch(`${API}/crsreport?limit=${Math.min(limit, 50)}&api_key=${encodeURIComponent(key)}&format=json`,
      { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`Congress.gov ${res.status}`);
    const d: any = await res.json();
    const reports = (d?.CRSReports ?? []).map((r: any): CrsReport => ({
      id: r?.id, title: r?.title ?? "(untitled)", publishDate: (r?.publishDate ?? null)?.slice?.(0, 10) ?? null,
      contentType: r?.contentType, url: r?.url || PUBLIC_CRS,
    }));
    return { ...base, live: true, total: d?.pagination?.count, reports };
  } catch (e) { return { ...base, note: `Live CRS reports unavailable (${e instanceof Error ? e.message : "error"}).` }; }
}

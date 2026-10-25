/**
 * Lobbying disclosure (Senate LDA) — for the member profile.
 *
 * HONESTY CONTRACT (read before extending):
 * LDA filings disclose the registrant (lobby firm), the client (who pays them), the issues/bills
 * lobbied, and sometimes the chamber contacted — they are NOT keyed to an individual member of
 * Congress (the `government_entities` field is frequently empty and never names a member). So we
 * never imply a filing targeted this specific person. What we honestly show is: lobbying on the
 * ISSUES / BILLS this member works on — "who is paying which firm to lobby on this topic."
 *
 * This is a DIFFERENT thing from FEC campaign money (who funds the member's campaign). Keep them
 * separate on the profile — never fuse LDA + FEC into one "influence" figure.
 *
 * Verified against the live API (lda.senate.gov/api/v1/filings/, `Authorization: Token <key>`):
 * free-text issue search via `filing_specific_lobbying_issues` works and is how we tie lobbying to
 * a member's legislation. Response: { count, next, previous, results: [...] }.
 */

export interface LobbyingFiling {
  registrant: string | null;   // the lobbying firm that filed
  client: string | null;       // who they lobby for (the paying interest)
  clientState?: string | null;
  issue: string | null;        // general issue area, e.g. "Environment/Superfund"
  description?: string;        // specific issues disclosed (free text)
  amount?: number | null;      // reported income or expenses (USD), if present
  year?: number;
  url?: string | null;         // link to the official filing document
}

export interface LobbyingResult {
  query?: string;
  year: number;
  source: string;
  live: boolean;
  note?: string;
  /** Always-correct official search, so the panel is useful even with no live data. */
  searchUrl: string;
  /** How to read what's shown — keeps the user from over-reading the data. */
  guidance: string;
  /** Total filings matching the query (may exceed filings.length, which is capped). */
  count?: number;
  filings: LobbyingFiling[];
}

/** Official Senate LDA public filing search (guaranteed-correct; no API key needed). */
export const LDA_SEARCH_URL = "https://lda.senate.gov/filings/public/filing/search/";
const LDA_API = "https://lda.senate.gov/api/v1/filings/";
const GUIDANCE =
  "This is registered lobbying on this topic — who is paying which firm to influence it. It is disclosed by issue, not by member, and is separate from campaign money (see Finance).";

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Map one raw LDA filing → our compact shape. */
function mapFiling(r: any): LobbyingFiling {
  const la = (r?.lobbying_activities ?? [])[0] ?? {};
  return {
    registrant: r?.registrant?.name ?? null,
    client: r?.client?.name ?? null,
    clientState: r?.client?.state_display ?? null,
    issue: la?.general_issue_code_display ?? null,
    description: (la?.description ?? "").slice(0, 240) || undefined,
    amount: num(r?.income) ?? num(r?.expenses),
    year: r?.filing_year,
    url: r?.filing_document_url ?? null,
  };
}

/** Live: search LDA filings by free-text issue/bill. Throws on non-200 so callers can fall back. */
export async function fetchLobbyingByIssue(query: string, key: string, year = new Date().getFullYear(), limit = 12): Promise<{ count: number; filings: LobbyingFiling[] }> {
  const u = new URL(LDA_API);
  u.searchParams.set("filing_specific_lobbying_issues", query);
  u.searchParams.set("filing_year", String(year));
  u.searchParams.set("page_size", String(Math.min(limit, 25)));
  const res = await fetch(u, { headers: { Authorization: `Token ${key}` } });
  if (!res.ok) throw new Error(`LDA ${res.status}`);
  const d: any = await res.json();
  return { count: d?.count ?? 0, filings: (d?.results ?? []).map(mapFiling) };
}

/**
 * Lobbying context for a search term (an issue or a bill the member works on).
 * - With a key + query → live filings.
 * - Without a key but with a query → bundled demo fixture (clearly marked, not fabricated live).
 * - Without a query → the honest framing + official search link only.
 */
export async function getLobbying(query: string | undefined, key?: string, year = new Date().getFullYear()): Promise<LobbyingResult> {
  const base: LobbyingResult = {
    query, year, source: "Senate Lobbying Disclosure Act (LDA) filings",
    live: false, searchUrl: LDA_SEARCH_URL, guidance: GUIDANCE, filings: [],
  };
  if (!query?.trim()) {
    return { ...base, note: "Enter an issue or bill to see who's lobbying on it." };
  }
  if (key) {
    try {
      const { count, filings } = await fetchLobbyingByIssue(query, key, year);
      return { ...base, live: true, count, filings };
    } catch (e) {
      return { ...base, note: `Live lobbying lookup unavailable (${e instanceof Error ? e.message : "error"}).` };
    }
  }
  // Fixture / demo mode — bundled real sample, clearly not live.
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "lobbying.json");
    const fx = JSON.parse(await readFile(path, "utf8")) as { count?: number; filings: LobbyingFiling[] };
    return { ...base, count: fx.count, filings: fx.filings, note: "Demo data — set LDA_API_KEY for live lobbying disclosure." };
  } catch {
    return { ...base, note: "Demo data unavailable. Set LDA_API_KEY for live lobbying disclosure." };
  }
}

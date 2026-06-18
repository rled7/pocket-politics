/**
 * Filibuster / cloture — from the Senate's official roll-call vote menu (senate.gov XML).
 *
 * A filibuster is overcome only by invoking CLOTURE (60 votes). So cloture votes are the public
 * record of what got filibustered: a cloture motion "Agreed to" = the filibuster was broken and the
 * measure advanced; "Rejected" = cloture failed, i.e. the filibuster held and the measure was blocked.
 * Verified live: 200+ cloture votes per session, each with the question, result, and tally.
 *
 * No API key needed (public XML). We parse with regex — the structure is flat and stable. Cached
 * with a long TTL (votes change a few times a day).
 */

const BASE = "https://www.senate.gov/legislative/LIS/roll_call_lists";
const UA = { "User-Agent": "PocketPolitics/0.1 (civic transparency)" };

export interface ClotureVote {
  voteNumber: string; date: string; issue: string; title: string;
  result: string; invoked: boolean; yeas: number; nays: number; url: string;
}
export interface ClotureResult {
  congress: number; session: number; source: string; live: boolean; note?: string;
  total: number; invoked: number; blocked: number; votes: ClotureVote[];
}

const tag = (block: string, t: string): string => {
  const m = block.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
  return m ? m[1].trim() : "";
};

function parse(xml: string, congress: number, session: number): ClotureVote[] {
  const out: ClotureVote[] = [];
  for (const m of xml.matchAll(/<vote>([\s\S]*?)<\/vote>/g)) {
    const b = m[1];
    if (!/cloture/i.test(tag(b, "question"))) continue;
    const result = tag(b, "result");
    const num = tag(b, "vote_number");
    out.push({
      voteNumber: num, date: tag(b, "vote_date"), issue: tag(b, "issue"), title: tag(b, "title"),
      result, invoked: /agreed/i.test(result),
      yeas: parseInt(tag(b, "yeas") || "0", 10), nays: parseInt(tag(b, "nays") || "0", 10),
      url: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${num}.htm`,
    });
  }
  return out;
}

/** Live: cloture votes for a congress/session, most recent first. Throws on non-200. */
export async function fetchCloture(congress: number, session: number): Promise<ClotureVote[]> {
  const res = await fetch(`${BASE}/vote_menu_${congress}_${session}.xml`, { headers: UA });
  if (!res.ok) throw new Error(`Senate ${res.status}`);
  const votes = parse(await res.text(), congress, session);
  // vote menu is already newest-first; keep that order.
  return votes;
}

function summarize(congress: number, session: number, votes: ClotureVote[]): ClotureResult {
  const invoked = votes.filter(v => v.invoked).length;
  return {
    congress, session, source: "U.S. Senate roll-call votes", live: true,
    total: votes.length, invoked, blocked: votes.length - invoked, votes: votes.slice(0, 30),
  };
}

// ── Per-senator detail for one roll-call vote (who voted Yea/Nay) ──
const VOTES = "https://www.senate.gov/legislative/LIS/roll_call_votes";
export interface SenatorVote { name: string; party?: string; state?: string; vote: string; }
export interface VoteDetail { congress: number; session: number; voteNumber: string; yea: SenatorVote[]; nay: SenatorVote[]; other: SenatorVote[]; live: boolean; note?: string; }

export async function getVoteDetail(congress: number, session: number, num: string): Promise<VoteDetail> {
  const base: VoteDetail = { congress, session, voteNumber: num, yea: [], nay: [], other: [], live: false };
  const padded = num.replace(/\D/g, "").padStart(5, "0");
  try {
    const res = await fetch(`${VOTES}/vote${congress}${session}/vote_${congress}_${session}_${padded}.xml`, { headers: UA });
    if (!res.ok) throw new Error(`Senate ${res.status}`);
    const xml = await res.text();
    const yea: SenatorVote[] = [], nay: SenatorVote[] = [], other: SenatorVote[] = [];
    for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
      const b = m[1];
      const sv: SenatorVote = { name: tag(b, "member_full"), party: tag(b, "party"), state: tag(b, "state"), vote: tag(b, "vote_cast") };
      if (/^yea$/i.test(sv.vote)) yea.push(sv); else if (/^nay$/i.test(sv.vote)) nay.push(sv); else other.push(sv);
    }
    return { ...base, live: true, yea, nay, other };
  } catch (e) { return { ...base, note: `Vote detail unavailable (${e instanceof Error ? e.message : "error"}).` }; }
}

/** Cloture votes for the current congress (tries the given session, falls back to session 1). */
export async function getCloture(congress = 119, session = 2): Promise<ClotureResult> {
  try {
    let votes = await fetchCloture(congress, session);
    if (!votes.length && session > 1) { session = 1; votes = await fetchCloture(congress, session); }
    return summarize(congress, session, votes);
  } catch {
    try {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cloture.json");
      const fx = JSON.parse(await readFile(path, "utf8")) as ClotureResult;
      return { ...fx, live: false, note: "Demo data — live cloture votes load from senate.gov." };
    } catch {
      return { congress, session, source: "U.S. Senate roll-call votes", live: false, note: "Cloture data unavailable.", total: 0, invoked: 0, blocked: 0, votes: [] };
    }
  }
}

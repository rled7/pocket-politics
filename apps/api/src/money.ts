/**
 * Money / campaign finance — "who funds this politician." Campaign finance comes from the
 * **FEC API** (api.open.fec.gov, free api.data.gov key). Members are mapped bioguide → FEC
 * candidate id via the public @unitedstates dataset (which carries `id.fec`).
 *
 * Graceful: no key → the demo fixture, so the section always renders. Lobbying-on-issues
 * (Senate LDA API) is the next money layer to add on top of this.
 */
import moneyFixture from "../fixtures/money.json";

export interface Money {
  bioguide: string;
  fecId?: string;
  cycle: number | null;
  totals: { raised: number; spent: number; cashOnHand: number } | null;
  outside?: { support: number; oppose: number } | null; // independent expenditures for / against
  sources?: { individuals: number; pacs: number; party: number; self: number } | null; // who funds them
  source: string;
  live: boolean;
  note?: string;
}
const FEC = "https://api.open.fec.gov/v1";

const LEGISLATORS = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
let legCache: Promise<any[]> | null = null;

async function fecIdFor(bioguide: string): Promise<string | undefined> {
  legCache ||= fetch(LEGISLATORS).then((r) => r.json());
  const all = await legCache;
  const rec = all.find((x: any) => x?.id?.bioguide === bioguide);
  const fec = rec?.id?.fec;
  return Array.isArray(fec) ? fec[fec.length - 1] : fec;
}

export async function getMoney(bioguide: string, fecKey?: string, cycle = 2024): Promise<Money> {
  if (!fecKey) {
    return { ...(moneyFixture as Omit<Money, "live">), bioguide, live: false,
      note: "Demo data — set FEC_API_KEY for live campaign finance." };
  }
  const fecId = await fecIdFor(bioguide);
  if (!fecId) {
    return { bioguide, cycle: null, totals: null, source: "FEC — api.open.fec.gov", live: true,
      note: "No FEC candidate id found for this member." };
  }
  const [tRes, oRes] = await Promise.all([
    fetch(`${FEC}/candidate/${fecId}/totals/?api_key=${fecKey}&cycle=${cycle}&per_page=1`),
    fetch(`${FEC}/schedules/schedule_e/by_candidate/?candidate_id=${fecId}&cycle=${cycle}&api_key=${fecKey}&per_page=100`, { signal: AbortSignal.timeout(8000) }).catch(() => null),
  ]);
  if (!tRes.ok) throw new Error(`FEC ${tRes.status}`);
  const t = ((await tRes.json()).results ?? [])[0] ?? {};
  let outside: { support: number; oppose: number } | null = null;
  try {
    if (oRes && oRes.ok) {
      const rows = (await oRes.json()).results ?? [];
      outside = { support: 0, oppose: 0 };
      for (const r of rows) (r.support_oppose_indicator === "S" ? outside.support += (r.total ?? 0) : outside.oppose += (r.total ?? 0));
    }
  } catch { /* leave null */ }
  const sources = {
    individuals: (t.individual_itemized_contributions ?? 0) + (t.individual_unitemized_contributions ?? 0),
    pacs: t.other_political_committee_contributions ?? 0,
    party: t.political_party_committee_contributions ?? 0,
    self: (t.candidate_contribution ?? 0) + (t.loans_made_by_candidate ?? 0),
  };
  return {
    bioguide, fecId, cycle,
    totals: { raised: t.receipts ?? 0, spent: t.disbursements ?? 0, cashOnHand: t.last_cash_on_hand_end_period ?? 0 },
    outside,
    sources: (sources.individuals || sources.pacs || sources.party || sources.self) ? sources : null,
    source: "FEC — api.open.fec.gov",
    live: true,
  };
}

/** Top employers of a member's donors (a "who funds them" proxy) — on-demand (heavier: 2 FEC calls). */
export interface Donors { bioguide: string; topEmployers: { employer: string; total: number }[]; live: boolean; note?: string; }
export async function getDonors(bioguide: string, fecKey?: string, cycle = 2024): Promise<Donors> {
  const base: Donors = { bioguide, topEmployers: [], live: false };
  if (!fecKey) return { ...base, note: "Set FEC_API_KEY for donor data." };
  const fecId = await fecIdFor(bioguide);
  if (!fecId) return { ...base, note: "No FEC candidate id for this member." };
  const t = () => AbortSignal.timeout(14000); // FEC by_employer aggregates server-side — can be slow; cap it
  try {
    const cm = (await (await fetch(`${FEC}/candidate/${fecId}/committees/?api_key=${fecKey}&cycle=${cycle}`, { signal: t() })).json()).results ?? [];
    const committee = (cm.find((c: any) => /principal/i.test(c.designation_full ?? "")) ?? cm[0])?.committee_id;
    if (!committee) return { ...base, live: true, note: "No campaign committee found." };
    const emp = (await (await fetch(`${FEC}/schedules/schedule_a/by_employer/?committee_id=${committee}&cycle=${cycle}&api_key=${fecKey}&per_page=10&sort=-total`, { signal: t() })).json()).results ?? [];
    return { bioguide, live: true, topEmployers: emp.map((e: any) => ({ employer: e.employer ?? "—", total: e.total ?? 0 })).filter((e: any) => e.employer && e.employer !== "—") };
  } catch (e) { return { ...base, note: `Donor data unavailable (${e instanceof Error ? e.message : "error"}).` }; }
}

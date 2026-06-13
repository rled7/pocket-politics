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
  source: string;
  live: boolean;
  note?: string;
}

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
  const res = await fetch(`https://api.open.fec.gov/v1/candidate/${fecId}/totals/?api_key=${fecKey}&cycle=${cycle}&per_page=1`);
  if (!res.ok) throw new Error(`FEC ${res.status}`);
  const data = await res.json();
  const t = (data.results && data.results[0]) || {};
  return {
    bioguide, fecId, cycle,
    totals: {
      raised: t.receipts ?? 0,
      spent: t.disbursements ?? 0,
      cashOnHand: t.last_cash_on_hand_end_period ?? 0,
    },
    source: "FEC — api.open.fec.gov",
    live: true,
  };
}

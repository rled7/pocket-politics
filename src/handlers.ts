/**
 * Data layer — the actual "build a response payload" logic, shared by BOTH the mutable
 * endpoints (`/api/profile`) and the immutable versioned ones (`/api/v/{version}/profile/...`),
 * so the logic exists once. Returns plain data objects (no `Response`), which keeps it
 * transport-agnostic and makes it the precise behavior the Rust backend must mirror for the
 * bake-off (see API_CONTRACT.md).
 *
 * Each function works with or without a Congress.gov key: no key → the bundled demo fixture
 * (so the site always demonstrates the product), key → the live record.
 */
import {
  fetchMember, fetchSponsored, fetchMembers, fetchBills,
  fetchBillRecordedVotes, fetchHouseVoteMembers, type MemberVote,
  fetchBillDetail, fetchBillSummary, fetchBillCosponsors,
} from "./congress.ts";
import { buildProfile } from "./profile.ts";
import type { ApiMember, ApiSponsored } from "./congress.ts";
import { mapLimit } from "./swr_cache.ts";
import memberFixture from "../fixtures/member.json";
import sponsoredFixture from "../fixtures/sponsored.json";
import membersFixture from "../fixtures/members.json";
import billsFixture from "../fixtures/bills.json";
import votesFixture from "../fixtures/bill_votes.json";
import billDetailFixture from "../fixtures/bill_detail.json";

export const DEFAULT_BIOGUIDE = "O000172"; // Rep. Alexandria Ocasio-Cortez (NY-14)

const note = (what: string) => `Demo data — set CONGRESS_API_KEY for ${what}.`;

export async function getProfile(bioguide: string, key?: string) {
  if (!key) {
    return {
      ...buildProfile(memberFixture as ApiMember, sponsoredFixture as ApiSponsored[]),
      live: false,
      note: note("the live record"),
    };
  }
  const [member, sponsored] = await Promise.all([fetchMember(bioguide, key), fetchSponsored(bioguide, key)]);
  return { ...buildProfile(member, sponsored), live: true };
}

export async function getMembers(limit: number, key?: string) {
  if (!key) {
    const members = membersFixture as unknown[];
    return { members, count: members.length, live: false, note: note("all 535 members") };
  }
  const members = await fetchMembers(key, limit);
  return { members, count: members.length, live: true };
}

export async function getBills(limit: number, key?: string) {
  if (!key) {
    const bills = billsFixture as unknown[];
    return { bills, count: bills.length, live: false, note: note("live bills") };
  }
  const bills = await fetchBills(key, limit);
  return { bills, count: bills.length, live: true };
}

/**
 * Bills enriched with each bill's SPONSOR — powers the bills feed's "group by state" view and
 * the per-post "sponsored by" line. The plain `getBills` (the frozen bake-off contract) stays
 * untouched; this is a TS-feature-tier endpoint. The sponsor fetches are bounded-concurrency and
 * cached by the SWR layer (warmed at boot), so the live page never pays the cost per request.
 */
export async function getBillsWithSponsors(limit: number, key?: string) {
  const base = await getBills(limit, key) as { bills: any[]; count: number; live?: boolean; note?: string };
  if (!key || !base.bills?.length) return base;
  const bills = base.bills.map((b) => ({ ...b }));
  await mapLimit(bills, 6, async (b) => {
    try {
      const d = await fetchBillDetail(b.congress, b.type, b.number, key);
      b.sponsor = d.sponsor
        ? { bioguideId: d.sponsor.bioguideId, fullName: d.sponsor.fullName, party: d.sponsor.party, state: d.sponsor.state }
        : null;
    } catch { b.sponsor = null; }
  });
  return { ...base, bills };
}

/**
 * "Who introduced this bill — and what it does." The sponsor (who introduced it) is always
 * present; the CRS summary often is NOT yet for very recent bills, so `summary` may be absent
 * and the UI must show an honest "summary pending" state. Source: Congress.gov (the same
 * CONGRESS_API_KEY already wired) — no additional API/key needed.
 */
export async function getBill(congress: number, type: string, number: string, key?: string) {
  if (!key) {
    return { ...billDetailFixture, source: "Congress.gov (demo)", live: false, note: note("the live sponsor & summary") };
  }
  const [detail, summary, cos] = await Promise.all([
    fetchBillDetail(congress, type, number, key),
    fetchBillSummary(congress, type, number, key),
    fetchBillCosponsors(congress, type, number, key).catch(() => ({ cosponsors: [], total: 0 })),
  ]);
  return { ...detail, summary, cosponsors: cos.cosponsors, cosponsorsTotal: cos.total, source: "Congress.gov API", live: true };
}

/**
 * "Who voted on this bill." Returns each roll call with per-member positions + tallies.
 * House positions come from Congress.gov's JSON house-vote endpoint; Senate roll calls are
 * listed but per-member positions need the LIS XML (not yet wired) — members will be empty.
 */
export async function getBillVotes(congress: number, type: string, number: string, key?: string) {
  if (!key) {
    return { ...votesFixture, live: false, note: "Demo data — set CONGRESS_API_KEY for live votes." };
  }
  const refs = await fetchBillRecordedVotes(congress, type, number, key);
  const rollCalls = await Promise.all(refs.map(async (ref) => {
    let members: MemberVote[] = [];
    if (ref.chamber === "House" && ref.rollNumber) {
      try { members = await fetchHouseVoteMembers(ref.congress, ref.session, ref.rollNumber, key); } catch { /* leave empty */ }
    }
    const totals: Record<string, number> = {};
    for (const m of members) totals[m.vote] = (totals[m.vote] ?? 0) + 1;
    return { ...ref, totals, members };
  }));
  return { bill: `${type.toUpperCase()} ${number} (${congress}th)`, rollCalls, live: true };
}

/**
 * Your representatives, by address. Geocodes → congressional district, then returns the
 * state's two senators + the district's House member. (Live needs CONGRESS_API_KEY for the
 * full 535; fixture mode only has the demo members.)
 */
/** Shared: a resolved District + the directory → that district's senators + House member. */
async function repsForDistrict(dist: { state: string; stateName: string; district: string }, inputLabel: string, key?: string) {
  const dir = await getMembers(540, key);
  const members = ((dir as { members: any[] }).members) ?? [];
  const inState = members.filter((m) => m.state === dist.stateName || m.state === dist.state);
  const senators = inState.filter((m) => m.chamber === "Senate");
  const rep = inState.find((m) => m.chamber === "House of Representatives" && String(m.district) === String(dist.district));
  return {
    input: inputLabel, found: true, state: dist.stateName, district: dist.district,
    representatives: [...senators, ...(rep ? [rep] : [])],
    live: (dir as { live?: boolean }).live !== false,
    note: (dir as { live?: boolean }).live === false ? "Demo members only — set CONGRESS_API_KEY for your real reps." : undefined,
  };
}

export async function getReps(address: string, key?: string) {
  const { geocodeDistrict } = await import("./geo.ts");
  const dist = await geocodeDistrict(address);
  if (!dist) return { input: address, found: false, note: "Couldn't locate that address — try a full street address or ZIP.", representatives: [] as unknown[] };
  return repsForDistrict(dist, address, key);
}

/** "Use my location" — browser geolocation coords → district → your reps. */
export async function getRepsByCoords(lat: number, lon: number, key?: string) {
  const { geocodeCoords } = await import("./geo.ts");
  const dist = await geocodeCoords(lat, lon);
  if (!dist) return { input: `${lat},${lon}`, found: false, note: "Couldn't pinpoint your district from your location — try entering an address.", representatives: [] as unknown[] };
  return repsForDistrict(dist, "your location", key);
}

/** Shared param parsing so every route clamps identically. */
export const clampLimit = (raw: string | null, def: number, max: number) =>
  Math.min(Math.max(parseInt(raw ?? String(def), 10) || def, 1), max);

export const isBioguide = (s: string) => /^[A-Z]\d{6}$/.test(s);

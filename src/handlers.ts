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
} from "./congress.ts";
import { buildProfile } from "./profile.ts";
import type { ApiMember, ApiSponsored } from "./congress.ts";
import memberFixture from "../fixtures/member.json";
import sponsoredFixture from "../fixtures/sponsored.json";
import membersFixture from "../fixtures/members.json";
import billsFixture from "../fixtures/bills.json";
import votesFixture from "../fixtures/bill_votes.json";

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

/** Shared param parsing so every route clamps identically. */
export const clampLimit = (raw: string | null, def: number, max: number) =>
  Math.min(Math.max(parseInt(raw ?? String(def), 10) || def, 1), max);

export const isBioguide = (s: string) => /^[A-Z]\d{6}$/.test(s);

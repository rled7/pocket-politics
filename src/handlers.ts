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
import { fetchMember, fetchSponsored, fetchMembers, fetchBills } from "./congress.ts";
import { buildProfile } from "./profile.ts";
import type { ApiMember, ApiSponsored } from "./congress.ts";
import memberFixture from "../fixtures/member.json";
import sponsoredFixture from "../fixtures/sponsored.json";
import membersFixture from "../fixtures/members.json";
import billsFixture from "../fixtures/bills.json";

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

/** Shared param parsing so every route clamps identically. */
export const clampLimit = (raw: string | null, def: number, max: number) =>
  Math.min(Math.max(parseInt(raw ?? String(def), 10) || def, 1), max);

export const isBioguide = (s: string) => /^[A-Z]\d{6}$/.test(s);

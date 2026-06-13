/**
 * Congress.gov API client (Phase 0).
 * Docs: https://api.congress.gov  ·  Free key: https://api.congress.gov/sign-up/
 * The data is public; Pocket Politics' value is AGGREGATING + presenting it.
 */
const BASE = "https://api.congress.gov/v3";

export interface ApiMember {
  bioguideId: string;
  directOrderName?: string;
  honorificName?: string;
  state?: string;
  partyHistory?: { partyName: string }[];
  terms?: { item?: { chamber: string }[] } | { chamber: string }[];
  addressInformation?: {
    officeAddress?: string;
    city?: string;
    district?: string;
    zipCode?: string;
    phoneNumber?: string;
  };
  officialWebsiteUrl?: string;
  depiction?: { imageUrl?: string };
  leadership?: { type?: string }[];
}

export interface ApiSponsored {
  type: string;        // e.g. "HR", "S"
  number: string;
  congress: number;
  title: string;
  introducedDate: string;
  policyArea?: { name: string };
  latestAction?: { actionDate: string; text: string };
}

// One row of the "everyone in Congress" directory (Congress.gov /member list shape).
export interface MemberSummary {
  bioguideId: string;
  name: string;
  party: string;
  state: string;
  district?: number | string;
  chamber: string;
  photo?: string;
}

// One bill currently moving through Congress (Congress.gov /bill list shape).
export interface ApiBill {
  congress: number;
  type: string;
  number: string;
  title: string;
  originChamber?: string;
  latestAction?: { actionDate: string; text: string };
  updateDate?: string;
}

async function get<T>(path: string, key: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}api_key=${key}&format=json`);
  if (!res.ok) throw new Error(`Congress.gov ${res.status} on ${path}`);
  return (await res.json()) as T;
}

export async function fetchMember(bioguideId: string, key: string): Promise<ApiMember> {
  const data = await get<{ member: ApiMember }>(`/member/${bioguideId}`, key);
  return data.member;
}

export async function fetchSponsored(bioguideId: string, key: string): Promise<ApiSponsored[]> {
  const data = await get<{ sponsoredLegislation: ApiSponsored[] }>(
    `/member/${bioguideId}/sponsored-legislation?limit=50`, key);
  return data.sponsoredLegislation ?? [];
}

// Every current member of Congress (House + Senate) as a directory. Congress.gov caps a
// single page at 250, but there are 535 members — so we paginate to get them all.
export async function fetchMembers(key: string, limit = 540): Promise<MemberSummary[]> {
  const PAGE = 250;
  const all: any[] = [];
  for (let offset = 0; all.length < limit; offset += PAGE) {
    const data = await get<{ members: any[] }>(`/member?currentMember=true&limit=${PAGE}&offset=${offset}`, key);
    const batch = data.members ?? [];
    all.push(...batch);
    if (batch.length < PAGE || offset > 600) break;
  }
  return all.slice(0, limit).map((m) => ({
    bioguideId: m.bioguideId,
    name: m.name ?? m.directOrderName ?? m.bioguideId,
    party: m.partyName ?? 'Unknown',
    state: m.state ?? 'Unknown',
    district: m.district,
    chamber: m.district != null && m.district !== '' ? 'House of Representatives' : 'Senate',
    photo: m.depiction?.imageUrl,
  }));
}

// Bills currently in Congress, most recently acted-on first.
export async function fetchBills(key: string, limit = 20): Promise<ApiBill[]> {
  const data = await get<{ bills: ApiBill[] }>(`/bill?limit=${limit}&sort=updateDate+desc`, key);
  return data.bills ?? [];
}

// ── Voting records ───────────────────────────────────────────────────────────
// "Who voted on this bill." House per-member positions come from Congress.gov's JSON
// house-vote endpoint; Senate per-member positions need the LIS XML (not yet wired).

export interface RecordedVoteRef {
  chamber: string; congress: number; session: number; rollNumber: number; date?: string; url?: string;
}
export interface MemberVote {
  bioguideId: string; name: string; vote: string; party?: string; state?: string;
}

/** Roll-call references attached to a bill's actions (chamber, roll number, link to the tally). */
export async function fetchBillRecordedVotes(
  congress: number, type: string, number: string, key: string,
): Promise<RecordedVoteRef[]> {
  const data = await get<{ actions?: { recordedVotes?: any[] }[] }>(
    `/bill/${congress}/${type.toLowerCase()}/${number}/actions?limit=250`, key);
  const out: RecordedVoteRef[] = [];
  for (const a of data.actions ?? []) {
    for (const rv of a.recordedVotes ?? []) {
      out.push({
        chamber: rv.chamber, congress: rv.congress, session: rv.sessionNumber,
        rollNumber: rv.rollNumber, date: rv.date, url: rv.url,
      });
    }
  }
  return out;
}

/** Every House member's position on a given roll call (Yea/Nay/Present/Not Voting). */
export async function fetchHouseVoteMembers(
  congress: number, session: number, rollNumber: number, key: string,
): Promise<MemberVote[]> {
  const data = await get<{ houseRollCallVoteMemberVotes?: { results?: any[] } }>(
    `/house-vote/${congress}/${session}/${rollNumber}/members`, key);
  return (data.houseRollCallVoteMemberVotes?.results ?? []).map((r) => ({
    bioguideId: r.bioguideID,
    name: [r.lastName, r.firstName].filter(Boolean).join(", "),
    vote: r.voteCast,
    party: r.voteParty,
    state: r.voteState,
  }));
}

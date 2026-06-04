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

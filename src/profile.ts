/**
 * Normalize raw Congress.gov data into a clean Pocket Politics profile.
 * Phase 0 = the PAST view (dated legislative record). Present/future
 * (live bill status, upcoming votes, schedule) arrive in later phases.
 */
import type { ApiMember, ApiSponsored } from "./congress.ts";

export interface RecordItem {
  id: string;          // e.g. "HR 1234 (118th)"
  title: string;
  date: string;        // YYYY-MM-DD
  policyArea?: string;
  latestAction?: string;
  role: "sponsored";
}

export interface Profile {
  bioguideId: string;
  name: string;
  party: string;
  state: string;
  chamber: string;
  record: RecordItem[];      // sorted newest-first
  generatedAt: string;
  sources: string[];
}

function chamberOf(m: ApiMember): string {
  const terms = (m as any).terms;
  const arr = Array.isArray(terms) ? terms : terms?.item;
  const last = Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined;
  return last?.chamber ?? "Congress";
}

export function buildProfile(member: ApiMember, sponsored: ApiSponsored[]): Profile {
  const record: RecordItem[] = sponsored.map((b) => ({
    id: `${b.type} ${b.number} (${b.congress}th)`,
    title: b.title,
    date: b.introducedDate,
    policyArea: b.policyArea?.name,
    latestAction: b.latestAction ? `${b.latestAction.actionDate}: ${b.latestAction.text}` : undefined,
    role: "sponsored",
  }));
  record.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  return {
    bioguideId: member.bioguideId,
    name: member.directOrderName ?? member.honorificName ?? member.bioguideId,
    party: member.partyHistory?.at(-1)?.partyName ?? "Unknown",
    state: member.state ?? "Unknown",
    chamber: chamberOf(member),
    record,
    generatedAt: new Date().toISOString(),
    sources: ["Congress.gov API (api.congress.gov) — public record"],
  };
}

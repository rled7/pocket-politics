/**
 * Normalize raw Congress.gov data into a clean Pocket Politics profile.
 * Phase 0 = the PAST view (dated legislative record). Present/future
 * (live bill status, upcoming votes, schedule) arrive in later phases.
 */
import type { ApiMember, ApiSponsored } from "./congress.ts";
import { salaryFor, type Pay } from "./salary.ts";

export interface RecordItem {
  id: string;          // e.g. "HR 1234 (118th)"
  title: string;
  date: string;        // YYYY-MM-DD
  policyArea?: string;
  latestAction?: string;
  role: "sponsored";
}

export interface Contact {
  office?: string;
  phone?: string;
  website?: string;
  photo?: string;
}

export interface Profile {
  bioguideId: string;
  name: string;
  party: string;
  state: string;
  chamber: string;
  salary: Pay;               // public congressional pay
  contact: Contact;          // office / phone / website / photo
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
  const record: RecordItem[] = sponsored
    // Real Congress.gov sponsored-legislation lists include non-bill entries (amendments,
    // or items with null type/number/title). Skip anything without a title or date so we
    // never render "null undefined". Clean bills are unaffected (contract-stable).
    .filter((b) => b && b.title && b.introducedDate)
    .map((b) => ({
      // Build the id defensively: "HR 1042 (118th)" for clean bills, but tolerate a missing
      // type or number rather than emitting "null"/"undefined".
      id: [[b.type, b.number].filter(Boolean).join(" "), b.congress ? `(${b.congress}th)` : ""]
        .filter(Boolean).join(" "),
      title: b.title,
      date: b.introducedDate,
      policyArea: b.policyArea?.name,
      latestAction: b.latestAction ? `${b.latestAction.actionDate}: ${b.latestAction.text}` : undefined,
      role: "sponsored",
    }));
  record.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

  const addr = member.addressInformation;
  const office = [addr?.officeAddress, addr?.city, addr?.district, addr?.zipCode]
    .filter(Boolean).join(", ") || undefined;

  return {
    bioguideId: member.bioguideId,
    name: member.directOrderName ?? member.honorificName ?? member.bioguideId,
    party: member.partyHistory?.at(-1)?.partyName ?? "Unknown",
    state: member.state ?? "Unknown",
    chamber: chamberOf(member),
    salary: salaryFor((member.leadership ?? []).map((l) => l.type ?? "")),
    contact: {
      office,
      phone: addr?.phoneNumber,
      website: member.officialWebsiteUrl,
      photo: member.depiction?.imageUrl,
    },
    record,
    generatedAt: new Date().toISOString(),
    sources: ["Congress.gov API (api.congress.gov) — public record", "Congressional salary: public record (CRS / 2 U.S.C. §4501)"],
  };
}

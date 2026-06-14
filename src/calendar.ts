/**
 * Congressional calendar — upcoming scheduled committee meetings, from Congress.gov.
 *
 * The list endpoint (/committee-meeting/{congress}) is sorted by update time and only returns
 * event IDs + detail URLs, so we fetch a window of recent events and then their details (bounded),
 * keep the ones with a real date, and sort by date — which surfaces the upcoming SCHEDULED meetings.
 * Verified live: returns future-dated "Scheduled" hearings/markups with committee + room.
 *
 * NOTE: this is N+1 (one list + a handful of detail fetches). It's cached with a long TTL and
 * excluded from the background refresh loop (see api_server) so it isn't re-pulled on a timer.
 * api.data.gov blocks default agents, so we send an explicit User-Agent.
 */

const API = "https://api.congress.gov/v3";
const UA = { "User-Agent": "PocketPolitics/0.1 (civic transparency)" };

export interface Meeting {
  title: string; date: string | null; status?: string | null; chamber?: string | null;
  type?: string | null; committee?: string | null; building?: string | null; room?: string | null;
}
export interface CalendarResult {
  source: string; live: boolean; note?: string; meetings: Meeting[];
}

/** Authoritative official schedules — always shown, always accurate, no API risk. */
export const OFFICIAL_CALENDARS = [
  { name: "House floor — today & this week", url: "https://docs.house.gov/floor/" },
  { name: "Senate floor schedule", url: "https://www.senate.gov/legislative/schedule.htm" },
  { name: "All committee meetings (Congress.gov)", url: "https://www.congress.gov/committees/meetings" },
  { name: "Days in session", url: "https://www.congress.gov/days-in-session" },
];

async function cg(path: string, key: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${sep}api_key=${encodeURIComponent(key)}&format=json`, { headers: UA });
  if (!res.ok) throw new Error(`Congress.gov ${res.status}`);
  return res.json();
}

function mapDetail(d: any): Meeting {
  const com = (d?.committees ?? [])[0] ?? {};
  const loc = d?.location ?? {};
  return {
    title: (d?.title ?? "").trim(), date: d?.date ?? null, status: d?.meetingStatus ?? null,
    chamber: d?.chamber ?? null, type: d?.type ?? null, committee: com?.name ?? null,
    building: loc?.building ?? null, room: loc?.room ?? null,
  };
}

/** Upcoming scheduled committee meetings (live), bounded by `scan` detail fetches.
 *  The list is sorted by UPDATE time and includes recently-edited PAST meetings, so we keep only
 *  meetings dated from today forward, then sort soonest-first — a real forward calendar. */
export async function fetchCalendar(key: string, congress = 119, scan = 30): Promise<Meeting[]> {
  const list = (await cg(`/committee-meeting/${congress}?limit=${scan}`, key))?.committeeMeetings ?? [];
  const out: Meeting[] = [];
  for (const m of list) {
    const u: string = m?.url ?? "";
    const mt = u.match(/committee-meeting\/(\d+)\/(\w+)\/(\d+)/);
    if (!mt) continue;
    try {
      const d = (await cg(`/committee-meeting/${mt[1]}/${mt[2]}/${mt[3]}`, key))?.committeeMeeting;
      if (d) out.push(mapDetail(d));
    } catch { /* skip a bad detail */ }
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = today.toISOString();
  return out.filter(m => m.date && m.date >= cutoff).sort((a, b) => (a.date! < b.date! ? -1 : 1)); // upcoming, soonest first
}

export async function getCalendar(key?: string): Promise<CalendarResult> {
  const base: CalendarResult = { source: "Congress.gov — committee meetings", live: false, meetings: [] };
  if (key) {
    try { return { ...base, live: true, meetings: (await fetchCalendar(key)).slice(0, 12) }; }
    catch (e) { return { ...base, note: `Live calendar unavailable (${e instanceof Error ? e.message : "error"}).` }; }
  }
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "calendar.json");
    const fx = JSON.parse(await readFile(path, "utf8")) as { meetings: Meeting[] };
    return { ...base, meetings: fx.meetings, note: "Demo data — set CONGRESS_API_KEY for the live calendar." };
  } catch {
    return { ...base, note: "Demo data unavailable. Set CONGRESS_API_KEY for the live calendar." };
  }
}

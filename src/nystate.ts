/**
 * New York State legislation — via the NY Senate Open Legislation API
 * (legislation.nysenate.gov/api/3, key as `?key=`). Verified live: the `/bills/{session}` list
 * returns 25k+ bills/session with sponsor, summary, status, and actions.
 *
 * This is the FIRST state-level data source — the template the rest of the per-state work
 * (#6/#25/#35) follows. Open Legislation also serves NY laws, session transcripts, committee
 * agendas, floor calendars, and member rosters — those are follow-on sections (#32/#33/#35).
 *
 * Honesty: NY data is New York only. We never imply it's national. Fixture fallback (a real
 * captured sample) keeps the page working with no key / offline.
 */

export interface NyBill {
  printNo: string;
  type: string;          // "Bill" | "Resolution"
  title: string;
  sponsor: string | null;
  summary?: string | null;
  status?: string | null;
  actionDate?: string | null;
  year?: number;
  url: string;           // official nysenate.gov bill page
}

export interface NyBillsResult {
  session: number;
  source: string;
  live: boolean;
  note?: string;
  total?: number;
  bills: NyBill[];
}

const API = "https://legislation.nysenate.gov/api/3";
const SOURCE = "NY Senate Open Legislation";

/** NY legislative sessions are 2-year and keyed to the odd start year (2025 covers 2025–26). */
export function nySession(year = new Date().getFullYear()): number {
  return year % 2 === 1 ? year : year - 1;
}

function mapBill(b: any): NyBill {
  const st = b?.status ?? {};
  const pn = b?.basePrintNo ?? b?.printNo;
  const session = b?.session ?? b?.year;
  return {
    printNo: pn,
    type: b?.billType?.resolution ? "Resolution" : "Bill",
    title: (b?.title ?? "").trim(),
    sponsor: b?.sponsor?.member?.fullName ?? null,
    summary: (b?.summary ?? "").trim().slice(0, 300) || null,
    status: st?.statusDesc ?? st?.statusType ?? null,
    actionDate: st?.actionDate ?? null,
    year: session,
    url: `https://www.nysenate.gov/legislation/bills/${session}/${pn}`,
  };
}

/** Live: recent NY bills, most-recent-action first. Throws on non-200 so callers can fall back. */
export async function fetchNyBills(limit: number, key: string, session = nySession()): Promise<{ total: number; bills: NyBill[] }> {
  const u = new URL(`${API}/bills/${session}`);
  u.searchParams.set("limit", String(Math.min(limit, 50)));
  u.searchParams.set("offset", "1");
  u.searchParams.set("sort", "status.actionDate:DESC");
  u.searchParams.set("key", key);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
  const d: any = await res.json();
  return { total: d?.total ?? 0, bills: (d?.result?.items ?? []).map(mapBill) };
}

/** NY bills with graceful fallback: live when keyed, else the bundled real fixture. */
export async function getNyBills(limit = 20, key?: string, session = nySession()): Promise<NyBillsResult> {
  const base: NyBillsResult = { session, source: SOURCE, live: false, bills: [] };
  if (key) {
    try {
      const { total, bills } = await fetchNyBills(limit, key, session);
      return { ...base, live: true, total, bills };
    } catch (e) {
      return { ...base, note: `Live NY lookup unavailable (${e instanceof Error ? e.message : "error"}).` };
    }
  }
  const fx = await loadFixture<{ session?: number; total?: number; bills: NyBill[] }>("ny_bills.json");
  if (fx) return { ...base, session: fx.session ?? session, total: fx.total, bills: fx.bills, note: DEMO_NOTE };
  return { ...base, note: "Demo data unavailable. Set NY_OPENLEG_API_KEY for live NY legislation." };
}

const DEMO_NOTE = "Demo data — set NY_OPENLEG_API_KEY for live NY legislation.";

async function loadFixture<T>(file: string): Promise<T | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", file);
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch { return null; }
}

// ── NY Laws (codified) ────────────────────────────────────────────────────────────────────────
export interface NyLaw { lawId: string; name: string; type?: string; url: string; }
export interface NyLawsResult { source: string; live: boolean; note?: string; total?: number; laws: NyLaw[]; }

function mapLaw(x: any): NyLaw {
  return { lawId: x?.lawId, name: x?.name, type: (x?.lawType ?? "").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase()),
    url: `https://www.nysenate.gov/legislation/laws/${x?.lawId}` };
}

/** The full catalog of NY consolidated/unconsolidated laws (≈137). */
export async function getNyLaws(key?: string): Promise<NyLawsResult> {
  const base: NyLawsResult = { source: SOURCE, live: false, laws: [] };
  if (key) {
    try {
      const res = await fetch(`${API}/laws?key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
      const d: any = await res.json();
      const laws = (d?.result?.items ?? []).map(mapLaw);
      return { ...base, live: true, total: laws.length, laws };
    } catch (e) { return { ...base, note: `Live NY laws unavailable (${e instanceof Error ? e.message : "error"}).` }; }
  }
  const fx = await loadFixture<{ total?: number; laws: NyLaw[] }>("ny_laws.json");
  if (fx) return { ...base, total: fx.total, laws: fx.laws, note: DEMO_NOTE };
  return { ...base, note: "Demo data unavailable. Set NY_OPENLEG_API_KEY for live NY laws." };
}

// ── NY Senate floor transcripts ───────────────────────────────────────────────────────────────
export interface NyTranscript { dateTime: string; sessionType?: string; url: string; }
export interface NyTranscriptsResult { source: string; live: boolean; note?: string; total?: number; transcripts: NyTranscript[]; }

/** Recent NY Senate session/hearing transcripts (records exist since 1993). Plain-language
 *  summarization of each is a follow-on (#32) — it needs an AI step. This surfaces ACCESS now. */
export async function getNyTranscripts(limit = 12, key?: string): Promise<NyTranscriptsResult> {
  const base: NyTranscriptsResult = { source: SOURCE, live: false, transcripts: [] };
  if (key) {
    try {
      const res = await fetch(`${API}/transcripts?limit=${Math.min(limit, 50)}&key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
      const d: any = await res.json();
      const transcripts = (d?.result?.items ?? []).map((t: any) => ({
        dateTime: t?.dateTime, sessionType: t?.sessionType, url: "https://www.nysenate.gov/transcripts",
      }));
      return { ...base, live: true, total: d?.total, transcripts };
    } catch (e) { return { ...base, note: `Live NY transcripts unavailable (${e instanceof Error ? e.message : "error"}).` }; }
  }
  const fx = await loadFixture<{ total?: number; transcripts: NyTranscript[] }>("ny_transcripts.json");
  if (fx) return { ...base, total: fx.total, transcripts: fx.transcripts, note: DEMO_NOTE };
  return { ...base, note: "Demo data unavailable. Set NY_OPENLEG_API_KEY for live NY transcripts." };
}

// ── A single transcript's full text (displayed locally — the public nysenate.gov page 404s) ──
export interface NyTranscriptText { dateTime: string; sessionType?: string; location?: string; text?: string; live: boolean; note?: string; }
export async function getNyTranscript(dateTime: string, key?: string): Promise<NyTranscriptText> {
  if (!key) return { dateTime, live: false, note: "Set NY_OPENLEG_API_KEY to load transcript text." };
  try {
    const res = await fetch(`${API}/transcripts/${encodeURIComponent(dateTime)}?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
    const r: any = (await res.json())?.result ?? {};
    return { dateTime, sessionType: r.sessionType, location: r.location, text: r.text ?? "", live: true };
  } catch (e) { return { dateTime, live: false, note: `Transcript unavailable (${e instanceof Error ? e.message : "error"}).` }; }
}

// ── NY Senate floor calendars + committee agendas ───────────────────────────────────────────────
export interface NyCalendar { calendarNumber: number; calDate: string | null; year?: number; url: string; }
export interface NyAgenda { number: number; year?: number; weekOf: string | null; billsConsidered?: number; committees?: number; url: string; }

/** NY Senate floor calendars (days bills are scheduled for the floor). */
export async function getNyCalendars(key?: string, session = nySession()): Promise<{ source: string; live: boolean; note?: string; total?: number; calendars: NyCalendar[] }> {
  const base = { source: SOURCE, live: false as boolean, calendars: [] as NyCalendar[] };
  if (key) {
    try {
      const res = await fetch(`${API}/calendars/${session}?limit=10&key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
      const d: any = await res.json();
      const calendars = (d?.result?.items ?? []).map((c: any) => ({ calendarNumber: c?.calendarNumber, calDate: c?.calDate ?? null, year: c?.year, url: "https://www.nysenate.gov/calendar" }));
      return { ...base, live: true, total: d?.total, calendars };
    } catch (e) { return { ...base, note: `Live NY calendars unavailable (${e instanceof Error ? e.message : "error"}).` }; }
  }
  const fx = await loadFixture<{ total?: number; calendars: NyCalendar[] }>("ny_calendars.json");
  if (fx) return { ...base, total: fx.total, calendars: fx.calendars, note: DEMO_NOTE };
  return { ...base, note: "Demo data unavailable. Set NY_OPENLEG_API_KEY for live NY calendars." };
}

/** NY Senate committee agendas (meetings where bills are considered + voted to the floor). */
export async function getNyAgendas(key?: string, session = nySession()): Promise<{ source: string; live: boolean; note?: string; total?: number; agendas: NyAgenda[] }> {
  const base = { source: SOURCE, live: false as boolean, agendas: [] as NyAgenda[] };
  if (key) {
    try {
      const res = await fetch(`${API}/agendas/${session}?key=${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`OpenLeg ${res.status}`);
      const d: any = await res.json();
      const agendas = (d?.result?.items ?? []).map((a: any) => ({ number: a?.id?.number, year: a?.id?.year, weekOf: a?.weekOf ?? null, billsConsidered: a?.totalBillsConsidered, committees: a?.totalCommittees, url: "https://www.nysenate.gov/calendar" }));
      return { ...base, live: true, total: d?.total, agendas };
    } catch (e) { return { ...base, note: `Live NY agendas unavailable (${e instanceof Error ? e.message : "error"}).` }; }
  }
  const fx = await loadFixture<{ total?: number; agendas: NyAgenda[] }>("ny_agendas.json");
  if (fx) return { ...base, total: fx.total, agendas: fx.agendas, note: DEMO_NOTE };
  return { ...base, note: "Demo data unavailable. Set NY_OPENLEG_API_KEY for live NY agendas." };
}

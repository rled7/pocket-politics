/**
 * OpenStates v3 — legislators + bills for ALL 50 states (open.pluralpolicy.com).
 * Auth: header `X-API-KEY`. Verified live against every state via `?jurisdiction=<State Name>`.
 *
 * ⚠️ RATE LIMITS (free/default tier): 500 requests/day, 1 request/sec. So:
 *   - On-demand only — NEVER prewarm (prewarming 50 states would blow the daily budget instantly).
 *   - Long cache TTL (see the route's sMaxAge) so a viewed state is refetched rarely.
 *   - EXCLUDED from the background refresh loop (api_server) so cached states aren't re-pulled.
 *   - The two calls per state (bills + people) run SEQUENTIALLY to stay under 1 req/sec.
 * Fixture fallback (a real captured sample) keeps the page working with no key / offline.
 */

const API = "https://v3.openstates.org";
const SOURCE = "OpenStates (Plural)";

/** Allowlist of valid jurisdictions — so a `state` param can never inject into the upstream URL. */
export const US_STATES = new Set([
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia",
  "Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts",
  "Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey",
  "New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
  "Wisconsin","Wyoming",
]);
export const isValidState = (s: string): boolean => US_STATES.has(s);

export interface StateBill {
  identifier: string; title: string; classification?: string | null;
  session?: string; latestAction?: string | null; latestDate?: string | null; url?: string;
}
export interface StateLegislator {
  name: string; party?: string | null; role?: string | null;
  chamber?: string | null; district?: string | null; image?: string | null; email?: string | null; url?: string;
}
export interface StateData {
  state: string; source: string; live: boolean; note?: string;
  legislators: StateLegislator[]; bills: StateBill[];
}

function mapBill(b: any): StateBill {
  return {
    identifier: b?.identifier, title: (b?.title ?? "").trim(),
    classification: (b?.classification ?? [])[0] ?? null, session: b?.session,
    latestAction: b?.latest_action_description ?? null, latestDate: b?.latest_action_date ?? null,
    url: b?.openstates_url,
  };
}
function mapPerson(p: any): StateLegislator {
  const cr = p?.current_role ?? {};
  return {
    name: p?.name, party: p?.party ?? null, role: cr?.title ?? null,
    chamber: cr?.org_classification ?? null, district: cr?.district != null ? String(cr.district) : null,
    image: p?.image || null, email: p?.email || null, url: p?.openstates_url,
  };
}

async function osGet(path: string, key: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { "X-API-KEY": key } });
  if (!res.ok) throw new Error(`OpenStates ${res.status}`);
  return res.json();
}

/** Legislators + recent bills for one state. Two SEQUENTIAL calls (≤1 req/sec). */
export async function getStateData(state: string, key?: string): Promise<StateData> {
  const base: StateData = { state, source: SOURCE, live: false, legislators: [], bills: [] };
  const j = encodeURIComponent(state);
  if (key) {
    try {
      // sequential, not parallel — respect the 1 req/sec limit
      const people = await osGet(`/people?jurisdiction=${j}&per_page=50`, key);
      const bills = await osGet(`/bills?jurisdiction=${j}&sort=latest_action_desc&per_page=15`, key);
      return {
        ...base, live: true,
        legislators: (people?.results ?? []).map(mapPerson),
        bills: (bills?.results ?? []).map(mapBill),
      };
    } catch (e) {
      return { ...base, note: `Live state lookup unavailable (${e instanceof Error ? e.message : "error"}).` };
    }
  }
  const fx = await loadFixture(state);
  if (fx) return { ...base, state: fx.state ?? state, legislators: fx.legislators, bills: fx.bills, note: "Demo data — set OPENSTATES_API_KEY for live, all-50-states data." };
  return { ...base, note: "Demo data unavailable. Set OPENSTATES_API_KEY for live state data." };
}

async function loadFixture(_state: string): Promise<{ state?: string; legislators: StateLegislator[]; bills: StateBill[] } | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const path = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "state.json");
    return JSON.parse(await readFile(path, "utf8"));
  } catch { return null; }
}

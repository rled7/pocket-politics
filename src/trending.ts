/**
 * Trending — the "observe what people engage with" half of the agentic idea (#39). Each time a bill
 * or member page is opened, the client pings a tracker; we keep a small popularity map in the Store
 * and surface the top items (e.g., in the HUD rail). The smarter "reframe content based on what people
 * search for" layer comes later behind the AI key — but the observation + surfacing is free and real.
 *
 * One bounded JSON map per kind (capped) — cheap to read/sort, no key-listing needed (works on KV too).
 */
import type { Store } from "./store.ts";

const MAX_TRACKED = 400;
const isId = (s: string) => /^[a-z0-9:_-]{1,60}$/i.test(s);
export const validKind = (s: string): boolean => s === "bill" || s === "member";

interface Entry { c: number; l?: string; } // count + most-recent label

export async function track(store: Store, kind: string, id: string, label?: string): Promise<void> {
  if (!validKind(kind) || !isId(id)) return;
  const key = `trending:${kind}`;
  let m: Record<string, Entry> = {};
  try { m = JSON.parse((await store.get(key)) || "{}"); } catch { /* reset */ }
  const e = m[id] ?? { c: 0 };
  e.c += 1;
  if (label) e.l = String(label).slice(0, 120);
  m[id] = e;
  const ids = Object.keys(m);
  if (ids.length > MAX_TRACKED) { // keep only the hottest
    const top = ids.sort((a, b) => m[b].c - m[a].c).slice(0, MAX_TRACKED);
    const nm: Record<string, Entry> = {};
    for (const k of top) nm[k] = m[k];
    m = nm;
  }
  await store.put(key, JSON.stringify(m));
}

export interface TrendingItem { id: string; count: number; label?: string; }
export async function getTrending(store: Store, kind: string, limit = 8): Promise<TrendingItem[]> {
  if (!validKind(kind)) return [];
  let m: Record<string, Entry> = {};
  try { m = JSON.parse((await store.get(`trending:${kind}`)) || "{}"); } catch { /* empty */ }
  return Object.entries(m)
    .sort((a, b) => b[1].c - a[1].c)
    .slice(0, limit)
    .map(([id, e]) => ({ id, count: e.c, label: e.l }));
}

/**
 * SwrCache — the in-memory stale-while-revalidate tier that makes every cached API response
 * serve at static-page speed (~1ms Map lookup) instead of blocking on a live Congress.gov call.
 *
 * The contract our responses already declare (`stale-while-revalidate` in Cache-Control, see
 * http.ts) but the serverless edge can't do and the old local cache didn't honor:
 *   - FRESH entry  → serve instantly (HIT).
 *   - STALE entry  → serve the stale copy instantly (STALE) AND refresh it in the background,
 *                    so a reader NEVER waits on a refetch once an entry exists.
 *   - MISS (cold)  → the only blocking path; eliminated for the common+prewarmed set by warm()
 *                    + the background fill in api_server.ts.
 * Single-flight (`inflight`) collapses concurrent refreshes of the same key into one upstream
 * call, so background revalidation can't stampede the gov API. See CACHING_ARCHITECTURE.md (L1).
 */
export interface CachedResponse {
  status: number;
  headers: [string, string][];
  body: string;
  etag?: string;
}

interface Entry extends CachedResponse {
  freshUntil: number; // epoch ms; past this the entry is stale-but-servable
}

/** What a loader returns: the response to cache + how long it stays FRESH. null = don't cache. */
export type LoadResult = { resp: CachedResponse; ttlMs: number } | null;

export class SwrCache {
  private store = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry | null>>();

  /** A servable entry (fresh or stale) if we have one, else undefined. */
  peek(key: string): { entry: Entry; fresh: boolean } | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    return { entry: e, fresh: e.freshUntil > Date.now() };
  }

  /**
   * Single-flight load: run `loader` to (re)populate `key`, deduping concurrent calls. On a
   * loader error or non-cacheable result we KEEP any existing (stale) entry — serving stale
   * beats serving an error (stale-if-error).
   */
  async load(key: string, loader: () => Promise<LoadResult>): Promise<Entry | null> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = (async (): Promise<Entry | null> => {
      try {
        const r = await loader();
        if (r && r.resp.status === 200) {
          // "Only pull new info": these gov upstreams don't honor conditional GET (FEC sends no
          // validators; senate.gov advertises an ETag but ignores If-None-Match → 200, not 304), so
          // we can't get a cheap server-side "unchanged". Instead we short-circuit HERE: if the fresh
          // body is byte-identical to what's cached, the data didn't change — just extend the freshness
          // window on the EXISTING entry (no object churn, no re-derivation downstream) and move on.
          const prev = this.store.get(key);
          if (prev && prev.body === r.resp.body) {
            prev.freshUntil = Date.now() + r.ttlMs;
            return prev;
          }
          const entry: Entry = { ...r.resp, freshUntil: Date.now() + r.ttlMs };
          this.store.set(key, entry);
          return entry;
        }
      } catch { /* keep stale on error */ }
      return this.store.get(key) ?? null;
    })();
    this.inflight.set(key, p);
    try { return await p; } finally { this.inflight.delete(key); }
  }

  /** Fire-and-forget background refresh (used when serving a STALE entry). */
  revalidate(key: string, loader: () => Promise<LoadResult>): void {
    if (this.inflight.has(key)) return; // already refreshing
    void this.load(key, loader);
  }

  keys(): string[] { return [...this.store.keys()]; }
  size(): number { return this.store.size; }
  /** True if the key is cached but past its freshness window (a no-op refresh would just waste an upstream call). */
  isStale(key: string): boolean { const e = this.store.get(key); return !!e && e.freshUntil <= Date.now(); }
}

/** Bounded-concurrency map — same pattern as ingest.ts, so background fill stays polite. */
export async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx]); } catch { /* one failure shouldn't stop the fill */ }
    }
  });
  await Promise.all(workers);
}

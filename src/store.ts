/**
 * Store — the graceful key/value abstraction (CACHING_ARCHITECTURE.md L2 +
 * PERSISTENT_SERVER_DEPLOYMENT.md §6). The app codes to THIS interface, never to a provider,
 * so switching hosts is a config change, not a rewrite:
 *   - Cloudflare KV in production (when bound)
 *   - in-memory locally / in tests
 *   - swap in Redis/Valkey for the persistent server
 *
 * "Graceful": if nothing is bound, getStore() returns a MemoryStore and callers still work —
 * adding KV is purely additive and never breaks serving (the project's standing principle).
 */
export interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Atomic-ish counter (used for view instrumentation → the cache-admission optimizer). */
  incr(key: string): Promise<number>;
}

/** In-memory store: a Map. Atomic incr in single-threaded JS. Default for local/tests. */
export class MemoryStore implements Store {
  private m = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.m.has(key) ? this.m.get(key)! : null;
  }
  async put(key: string, value: string): Promise<void> {
    this.m.set(key, value);
  }
  async incr(key: string): Promise<number> {
    const n = (parseInt(this.m.get(key) ?? "0", 10) || 0) + 1;
    this.m.set(key, String(n));
    return n;
  }
}

/** Minimal shape of a Cloudflare KV namespace (so we don't need workers-types here). */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** Adapt a Cloudflare KV namespace to the Store interface. */
export function kvStore(kv: KVLike): Store {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttl) => kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined),
    // KV has no native incr; read-modify-write. Racy under concurrency, but fine for
    // approximate view counts (the optimizer only needs relative popularity, not exact totals).
    incr: async (key) => {
      const n = (parseInt((await kv.get(key)) ?? "0", 10) || 0) + 1;
      await kv.put(key, String(n));
      return n;
    },
  };
}

/** Pick the store from the environment: KV when bound, else in-memory (graceful fallback). */
export function getStore(env?: { POCKETPOL_KV?: KVLike }): Store {
  return env?.POCKETPOL_KV ? kvStore(env.POCKETPOL_KV) : new MemoryStore();
}

/** Read a `views:{bioguide}` popularity map from the store for the optimizer. Empty → proxy. */
export async function readViews(store: Store, bioguides: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of bioguides) {
    const v = await store.get(`views:${id}`);
    if (v != null) out[id] = parseInt(v, 10) || 0;
  }
  return out;
}

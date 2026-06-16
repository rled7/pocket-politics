/**
 * Tiny in-memory fixed-window rate limiter for the unauthenticated POST endpoints. It exists mostly
 * to protect the EXPENSIVE path — `/api/translate` triggers a paid AI call, so an uncapped endpoint
 * is a cost-DoS hole (the always-on cost-optimizer flags this). Also throttles comment/reaction/
 * checkout spam. In-process only (fine for one server; a shared store would be needed across replicas).
 */
interface Bucket { count: number; reset: number; }
const buckets = new Map<string, Bucket>();

/** Allow `max` hits per `windowMs` per key. Returns ok:false + retryAfter (seconds) when exceeded. */
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  // opportunistic prune so the map can't grow unbounded
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
  return b.count > max ? { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) } : { ok: true, retryAfter: 0 };
}

export const _bucketCount = () => buckets.size; // test/diagnostic only

/**
 * Profile-view instrumentation — the demand signal behind the ingest optimizer (it reads
 * `views:{bioguide}` counts to decide what to pre-generate, see optimize.ts / store.ts readViews).
 *
 * Host-agnostic and tiny so it can be unit-tested without a Workers runtime: the caller supplies the
 * Store and a `waitUntil`. Counting happens in the background and a KV write failure (the free plan
 * caps writes at 1,000/day) must NEVER fail or slow the request, so every error is swallowed.
 */
import { DEFAULT_BIOGUIDE, isBioguide } from "./handlers.ts";
import type { Store } from "./store.ts";

/** `views:{BIOGUIDE}` if this request is a valid profile page view, otherwise null. */
export function profileViewKey(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.pathname.replace(/\/+$/, "") !== "/api/profile") return null;
  const bioguide = (url.searchParams.get("bioguide") || DEFAULT_BIOGUIDE).toUpperCase();
  return isBioguide(bioguide) ? `views:${bioguide}` : null;
}

/** Count a profile view in the background; never throws, never blocks. */
export function recordProfileView(request: Request, store: Store, waitUntil: (promise: Promise<unknown>) => void): void {
  const key = profileViewKey(request);
  if (!key) return;
  try {
    waitUntil(store.incr(key).catch(() => { /* instrumentation only — swallow */ }));
  } catch { /* waitUntil itself failed — still never fail the request */ }
}

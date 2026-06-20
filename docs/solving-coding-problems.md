# Solving Coding Problems — Pocket Politics playbook

A running log of every problem that took real time to diagnose. For each: the **symptom**, what we
**expected vs. got**, every **attempt** (including dead ends), the **root cause**, and the
**solution** with code. Read this FIRST when a hard bug shows up — we may have already paid for it.

---

## Problem #001 — Background refresh loop silently exceeded upstream API rate limits (3×+)

**Date:** 2026-06-20 · **Area:** `src/api_server.ts` (refresh loop), `src/swr_cache.ts` · **Build:** ~92

### Symptom
The SWR cache + prewarm makes pages instant, but the user's instinct flagged it: *"some of these API
points do not like the pre-warming situation… one had a limit of 500."* No crash, no error in the UI —
that's what made it dangerous. The cache served stale-but-fine data while the background loop was
quietly hammering the government APIs and almost certainly eating `429 Too Many Requests` on revalidate
(swallowed by our `stale-if-error` path, so invisible).

### Expected vs. Actual
- **Expected:** keep ~540 prewarmed entries fresh with a modest, quota-safe number of background calls.
- **Actual:** the loop re-pulled **every cached key every 4 minutes**, unconditionally.

### Root cause (two compounding bugs)
1. **`revalidate()` re-fetches unconditionally.** It calls `load()`, and `load()` always runs the
   loader (the live upstream fetch) regardless of whether the entry was still fresh:
   ```ts
   // src/swr_cache.ts — BEFORE
   revalidate(key, loader) {
     if (this.inflight.has(key)) return;
     void this.load(key, loader);          // ← always hits upstream; no freshUntil check
   }
   ```
2. **The loop iterated `apiCache.keys()` (everything) behind a DENYLIST.** It excluded only
   `/api/state` and `/api/calendar`. After prewarm fills ~540 member profiles, the math is brutal:
   ```
   540 profiles × 2 Congress.gov calls each × (60/4) cycles/hr  ≈  16,200 calls/hour
   Congress.gov ceiling: 5,000/hour  →  ~3.3× OVER.
   ```
   Worse: the **denylist is fail-OPEN**. Every endpoint added later is a silent leak until someone
   remembers to exclude it. This session we'd added `/api/local/officials` (**OpenStates — 500/DAY**),
   `/api/money` & `/api/donors` (FEC — 1,000/hr), `/api/ny/bill` & `/api/ny/transcript` (NY OpenLeg).
   A handful of cached city lookups re-pulled every 4 min = 15/hr each → the **500/day** OpenStates
   quota is gone by lunch. That's the "one with a limit of 500" the user named.

### Verified upstream rate limits (looked up, not guessed)
| Upstream | Used by | Limit |
|---|---|---|
| Congress.gov (api.data.gov) | members, bills, profiles, budget, record | **5,000 / hour** (raised from 1,000 in Mar 2024) |
| FEC OpenFEC (api.data.gov) | money, donors | **1,000 / hour** (7,200/hr = 120/min on request) |
| OpenStates v3 | states, local officials | **500 / day**, 10 / min (default tier) |
| Senate LDA | lobbying | **120 / min** registered (15/min anon) |
| senate.gov roll-call XML | cloture | no key, no documented quota |
| NY Open Legislation | NY bills/laws/transcripts | not publicly documented → treat as modest |

### Attempts / dead ends
- **(dead end) Conditional GET (`If-None-Match` / ETag → 304).** The obvious "ask the server if it
  changed before pulling" — but probed empirically and it **doesn't work on these APIs**:
  ```
  FEC          → no ETag, no Last-Modified header at all.
  senate.gov   → sends ETag "6ffe-62b5fc12aa078", but If-None-Match returns HTTP 200, NOT 304.
  NY OpenLeg   → no validators, only Cache-Control: private.
  ```
  So `If-None-Match` plumbing would be dead code for every current upstream. Don't build it.
- **(rejected) Just raise the interval.** Slower bleed, same fail-open denylist design. Doesn't fix
  the structural problem.

### Solution
**1. Make `revalidate` cheap to gate — add `isStale()` and skip fresh keys.**
```ts
// src/swr_cache.ts — AFTER
/** True if the key is cached but past its freshness window (a no-op refresh would waste a call). */
isStale(key: string): boolean { const e = this.store.get(key); return !!e && e.freshUntil <= Date.now(); }
```

**2. Refresh loop = explicit ALLOWLIST (fail-SAFE), gated on `isStale`.** Only proactively refresh
keys backed by generous / no-key upstreams. Everything else rides on-access SWR (bounded by real
traffic, single-flighted) — so it's quota-safe and a *new endpoint is safe by default*.
```ts
// src/api_server.ts — AFTER
const REFRESH_ALLOWLIST = [
  ...COMMON_KEYS,                 // Congress.gov: members directory + bills feeds (5,000/hr)
  "/api/budget", "/api/record",  // Congress.gov singletons
  "/api/cloture",                // senate.gov XML — no key, no quota
];
function startRefreshLoop(): void {
  if (!PREWARM) return;
  setInterval(() => {
    for (const k of REFRESH_ALLOWLIST) {
      if (apiCache.isStale(k)) apiCache.revalidate(k, () => runRoute(k));
    }
  }, 240_000).unref();
}
```

**3. "Only pull new info" without server-side 304 — content-hash short-circuit in `load()`.** Since the
upstreams won't tell us "unchanged," we detect it ourselves: if a refreshed body is byte-identical to
what's cached, don't churn the entry — just extend its freshness window.
```ts
// src/swr_cache.ts — AFTER (inside load())
const prev = this.store.get(key);
if (prev && prev.body === r.resp.body) {     // data didn't actually change
  prev.freshUntil = Date.now() + r.ttlMs;    // extend freshness, no object churn / re-derivation
  return prev;
}
```

### Why the boot prewarm is fine (left as-is)
One-time boot fills ~540 profiles = ~1,080 Congress.gov calls, concurrency 6, Congress-only → under the
5,000/hr ceiling. It's the *recurring* loop that was over budget, not the one-time warm. Profiles are
filled once and never evicted, so dropping them from the loop costs **zero** latency: they serve
stale-instant and refresh on next view.

### Lesson
A cache that fails silently is worse than one that errors. **Rate-limit governance must be fail-safe:
allowlist what you proactively pull, never denylist.** And before reaching for `If-None-Match`, *probe
the actual upstream* — government APIs frequently advertise validators they don't honor.

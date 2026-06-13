# Pocket Politics — Caching Architecture ("eliminate the lag")

> **Goal (user, 2026-06-13):** millions of concurrent readers, *zero* perceptible lag,
> correctness preserved. Research-backed. Language-agnostic: the **TypeScript** and
> **Rust** backends implement the *same* caching contract; the comparison only changes
> the cold/ingest path (see §8).
>
> **The governing insight:** civic data changes on the order of **hours to days**, never
> seconds. So the request path must do **no real work** — every read is "serve precomputed
> bytes from the nearest city." The expensive work (fetch upstream, normalize, summarize)
> runs **once**, on a timer, decoupled from all reads. That is the "backend runs only once"
> principle, made literal.

---

## 0. The latency budget (what "no lag" actually means)

| Path | Target | How |
|---|---|---|
| Warm read (the 99.9% case) | **CDN edge, single-digit ms** | precomputed static JSON / edge cache HIT — no Function runs |
| Cache-expiry read | **instant (stale served)** | async stale-while-revalidate — revalidate in background |
| Cold miss (rare) | **< 20 ms** | KV (globally replicated), never the upstream API |
| Upstream outage | **still serves** | stale-if-error |
| Ingest (off the read path) | minutes, on a Cron Trigger | does ALL the expensive work once |

**Honest framing first:** once the CDN absorbs reads, **TS vs Rust will look nearly
identical in production latency** — the win comes from the cache layers below, not the
language. The bake-off measures something real only on the **cold/ingest path** (§8). Don't
expect the language choice to move the warm-path number; expect the *architecture* to.

---

## 1. The layer cake (request travels top-down; stops at the first hit)

```
 Client (browser / iOS / Android)
   │  HTTP cache: ETag/304, immutable versioned data, app-shell immutable
   ▼
 L0  CDN static object          ← hottest reads are PRE-GENERATED files; no compute at all
   ▼ (miss)
 L1  Edge cache (Cache-Control + async SWR + stale-if-error)   ← Function ran once per key/TTL
   ▼ (miss)
 L2  KV (globally replicated hot store)   ← read-only on the request path; written by ingest
   ▼ (miss)
 L3  D1 (relational/search)  +  R2 (bulk snapshots)
   ▲
 L4  INGEST (Cron Trigger, runs once): upstream → normalize → LLM summarize → write L0/L2/L3
        The ONLY thing that ever touches Congress.gov / OpenStates / FEC.
```

A user request can, at worst, reach L2 (KV, single-digit ms). It can **never** reach the
upstream gov API — that is the "ingest, don't proxy" rule, and it's what makes 1M concurrent
trivial: gov APIs only ever see our handful of ingest calls.

> **L-1 (in-process in-memory LRU) — exists ONLY on a persistent-server deployment.** This is
> the fastest tier of all (nanoseconds, no network) but it requires a long-lived process to
> hold the map. On stateless serverless Workers, isolates are ephemeral and this tier barely
> exists; on a **persistent Node/Rust server or a Durable Object** it's enormous. Whether L-1
> is in the cake is decided by the deployment-model fork (§8 / open decision) — it materially
> changes the Rust target and the bench harness, so it's a user call, not an assumption.

---

## 2. L0 — Precomputed static JSON (the biggest lag-killer)

The boldest, simplest idea: for the hottest reads, **don't run a Function at all.** Ingest
writes the normalized response as a real static object the CDN serves directly.

- `/api/members` (the full directory) and `/api/profile` for the top-N members become
  **pre-generated objects** on the CDN. Request → nearest edge → bytes. You cannot beat this.
- New since the BLUEPRINT: pair it with the **version-pointer scheme** (§4) so these objects
  are **`immutable`** and never revalidate.

**Why it wins:** "fastest possible" is a static file from the nearest PoP. Everything else in
this doc exists only for the long tail that isn't pre-generated.

---

## 3. L1 — Edge cache with async stale-while-revalidate

For everything not pre-generated, the Function runs **once per (key, PoP, TTL window)**;
every other reader gets the cached response.

**The exact header (set on every cacheable Function response):**
```
Cache-Control: public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400
```
- `s-maxage=300` — fresh at the edge for 5 min (CDN tier; shared).
- `stale-while-revalidate=86400` — **for 24h after expiry, serve stale INSTANTLY and
  revalidate in the background.** Live on all plans since 2026-02-26; first post-expiry
  request returns stale with an `UPDATING` status, no one blocks on the origin.
- `stale-if-error=86400` — if revalidation fails (gov API down), keep serving stale for 24h.

**Hard constraint we design around:** async SWR works **only** with `Cache-Control` headers,
**not** the Workers Cache API (`cache.put`/`cache.match`). → **Rule: set headers on the
`Response` and let the CDN do SWR; do not hand-roll caching with the Cache API for the
read path.** (Cache API stays available for bespoke fragment caching where we accept manual
revalidation.)

**Known issue to test, not assume:** there's a reported interaction where **Tiered Cache can
interfere with SWR**. We enable Tiered Cache (§6) but add a conformance test that asserts a
post-expiry request returns instantly with stale data; if Tiered Cache breaks SWR in our
account, we choose one deliberately rather than discover it in prod.

> ⚠️ **L1 is UNVERIFIED until we curl it — do not treat as load-bearing yet.** Async SWR is
> documented for `Cache-Control` "set by your origin." A **Pages Function** response is
> *dynamic* and is **not** automatically stored in the CDN cache the way a static asset is —
> it may return `cf-cache-status: DYNAMIC` (never cached, never SWR). The standard way to
> cache a dynamic Function response is the Cache API, which (per §3) does **not** support SWR.
> **Discriminating test (= build-order step 1):** deploy one Function with the header above,
> `curl -sI` it twice past `s-maxage`, read `cf-cache-status`. HIT→UPDATING = L1 works as
> written. MISS/DYNAMIC = dynamic responses aren't edge-cached → we push that data onto the
> **L0 / immutable path (§2, §4), which is real static-asset caching where `Cache-Control`
> genuinely applies** and which already carries the hot path. Net: lean on L0/immutable;
> keep dynamic-L1-SWR provisional until the curl passes.

---

## 4. NEW IDEA — version-pointer indirection (immutable caching on mutable data)

The trick CDNs use for hashed asset filenames (`app.4f3a.js`, cached forever), applied to
civic data:

- Ingest stamps every batch with a monotonic **`dataVersion`** (e.g. unix-ts of the run).
- Data is served at **content-addressed, immutable URLs**:
  `GET /api/v/{dataVersion}/profile/O000172.json` → `Cache-Control: public, max-age=31536000, immutable`
  These **never revalidate** — once an edge has them, reads are free forever.
- A single tiny **mutable pointer** says what's current:
  `GET /api/latest` → `{ "dataVersion": 1718294400 }` with `s-maxage=30, stale-while-revalidate=300`.

**Read flow:** client fetches the cheap pointer (or reads it from the app shell, §7) → then
fetches the immutable data once and caches it indefinitely. Freshness is controlled by a
~5 KB pointer, not by revalidating every payload. **Result: payload revalidation traffic → ~0.**

Trade-off (named honestly): one extra round trip (pointer → data). Mitigations: embed the
current `dataVersion` into the app shell at deploy time so the first load needs no pointer
hop; use **103 Early Hints** to `preload` the data URL alongside the pointer; the pointer is
so small + so cacheable it's effectively free on repeat views.

---

## 5. L2/L3 — KV / D1 / R2 (the warm + cold stores)

- **KV** — globally replicated, single-digit-ms reads, massive read throughput. The
  request-path fallback when L0/L1 miss. **Read-only on requests; written only by ingest.**
- **D1 (SQLite)** — relational + search (members by state/party, full-text bill search).
  Behind KV; only hit for queries that aren't a simple key lookup.
- **R2** — bulk JSON snapshots + the source for regenerating L0 static objects; also backs
  **Cache Reserve** persistence.
- **Graceful binding (already a project principle):** `store.ts` no-ops if KV isn't bound and
  falls back to fixtures, so adding/removing a store is purely additive and never breaks
  serving. Both backends honor this.

---

## 6. CDN-level switches (turn these on)

- **Tiered Cache** — regional tiers absorb misses so the origin-tier (not the origin) is the
  fallback; multiplies hit ratio for a global audience. (Test SWR interaction, §3.)
- **Cache Reserve** — persistent backing so cold/long-tail objects survive eviction; first
  miss in weeks still doesn't hit compute.
- **Cache-Tags / surrogate keys** — tag each object by entity (`member:O000172`, `bill:hr1-118`).
  When ingest updates one member, **purge only that tag**, not the world. Targeted
  invalidation = high TTLs without staleness risk.
- **Brotli** on JSON; **precompress** the L0 static objects at ingest.
- **Negative caching** — cache `404`/"no such member" briefly so junk lookups don't
  repeatedly wake compute.

---

## 7. Client-side (the last mile)

- **App shell** = versioned bundles, `Cache-Control: public, max-age=31536000, immutable`.
  Repeat visits load instantly from disk; only changed when the version hash changes.
- **ETag + `If-None-Match`** on any non-immutable endpoint → `304 Not Modified` (tiny) when
  unchanged. Big win for mobile/repeat readers.
- **Embed `dataVersion` in the shell** at deploy so the first data fetch skips the pointer hop.
- **Service worker (web)** — optional offline/instant-back: cache-first for immutable data,
  SWR for the pointer. Mirrors the same policy the CDN runs, one tier closer to the user.

---

## 8. What the TS-vs-Rust bake-off actually measures

Because §0–§7 are mostly **CDN/edge and language-agnostic**, the warm path is identical for
both backends. The honest, *measurable* difference is the **cold path**:

| Measured | Where language matters |
|---|---|
| **Ingest throughput** | fetch+normalize+write N thousand members/bills; CPU + allocs |
| **Cold-miss compute** | the work to build one response on an L1/L2 miss (parse, shape JSON) |
| **Memory / cold-start** | Rust WASM vs TS isolate startup + steady-state footprint |
| **Tail latency under load** | p95/p99 on the miss path at concurrency (GC pauses vs none) |

So `bench/run_all.sh` (AlgoForge pattern) **isolates each backend (one running at a time —
your "running only once" reading #2)**, hits the **miss path** with identical fixtures, and
records p50/p95/p99 + ingest throughput. Conformance gate first (byte-equal to the frozen
fixtures, per `API_CONTRACT.md`) — a backend that isn't correct never gets ranked. The warm
path is reported too, but we'll state up front it should tie.

---

## 9. Failure & correctness (eliminating lag without lying)

- **Never block a reader on the upstream** — SWR + stale-if-error guarantee a reader always
  gets *something* instantly, even mid-revalidation or during a gov outage.
- **Single-flight on miss** — under a thundering herd, only ONE fetch per key repopulates the
  cache (`waitUntil` + a per-key lock / cache lock); 10k simultaneous misses ≠ 10k upstream
  calls.
- **Correctness via the pointer** — staleness is bounded and *visible*: the UI can show
  "as of {dataVersion}" so instant-but-slightly-stale is honest, not hidden.
- **No fabrication** — LLM bill summaries are generated **once at ingest**, cached, and cite
  the source; never per-request, never invented (ties to the always-on cost-optimizer:
  summarize-once is also the cheapest path).

---

## 10. Build order (caching-first, so lag is engineered in from day one)

1. **Headers + SWR** on the existing TS Functions — the cheapest 90% of the win, ships today.
2. **Version-pointer scheme** (`/api/latest` + `/api/v/{ver}/…` immutable) — both backends.
3. **L0 pre-generation** of `/api/members` + top-N profiles at ingest.
4. **KV store wrapper** (graceful) wired as the L2 fallback.
5. **Cron ingest job** — the once-running backend; writes L0/L2/L3, stamps `dataVersion`.
6. **Tiered Cache + Cache Reserve + Cache-Tags** turned on; SWR-interaction test.
7. **`bench/run_all.sh`** — conformance + cold-path benchmark; then build the **Rust** backend
   to the same contract and run the bake-off.

---

### Sources (verified 2026-06-13)
- Cloudflare — async stale-while-revalidate (live 2026-02-26): https://developers.cloudflare.com/changelog/post/2026-02-26-async-stale-while-revalidate
- Cloudflare Workers Cache API: https://developers.cloudflare.com/workers/runtime-apis/cache/
- Cloudflare Origin Cache-Control: https://developers.cloudflare.com/cache/concepts/cache-control/
- Tiered-Cache ↔ SWR interaction report: https://community.cloudflare.com/t/bug-tiered-cache-interferes-with-stale-while-revalidate-behavior/855014
- HTTP caching (ETag / Cache-Control / SWR) in Node APIs: https://dev.to/boehner/http-caching-in-nodejs-apis-etag-cache-control-and-stale-while-revalidate-explained-9ce
- API gateway caching patterns: https://zuplo.com/learning-center/api-gateway-caching

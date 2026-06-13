# Changelog

All notable changes to Pocket Politics. Format follows [Keep a Changelog](https://keepachangelog.com);
this project uses date-stamped milestones while pre-1.0.

## [0.7.0] — 2026-06-13 — Votes, comments, money, state organization, perf
### Added
- **Voting records** — `GET /api/votes?congress=&type=&number=`: each roll call on a bill with
  per-member Yea/Nay/Present/Not-Voting + tallies. House positions via Congress.gov's
  `house-vote` JSON (verified live: HR 3424/119 → 397-1-32); Senate roll calls listed,
  per-member needs LIS XML (flagged). **`web/bill.html`** shows who voted (Yea/Nay columns);
  bills on the profile link to it.
- **Voter comments on bills** — `GET/POST /api/comments` over the graceful `Store` (KV in prod,
  in-memory locally). Comment form + list on `bill.html`. Self-attested USER OPINION, separate
  from the official record; registered-voter verification is future work (needs an identity provider).
- **Campaign finance (money)** — `GET /api/money?bioguide=`: maps bioguide → FEC candidate id
  via the @unitedstates dataset, then FEC totals (raised/spent/cash). Profile "Campaign finance"
  card. Demo fixture without `FEC_API_KEY`. Senate **LDA lobbying** is the next money layer.
- **Organize members by state** — `web/explore.html` "Group by state" view (alphabetical state
  sections, counts), alongside search + House/Senate filters.

### Performance
- **Parallel ingest** — profile fetches now run with bounded concurrency (was sequential).
- **In-memory cache tier** in the persistent server (`api_server.ts`) — first request hits
  Congress.gov, subsequent ones within TTL serve from memory (`X-Cache: HIT/MISS`). The real fix
  for slow Congress fetches = ingest-don't-proxy + cache.

### Ops / docs
- `wrangler.toml` + `DEPLOY.md` (turnkey Cloudflare steps); `.github/workflows/ci.yml`
  (typecheck + tests + Rust build + conformance gate); README/tracker refreshed.
- `src/api_server.ts` also serves the static web client → `npm run api` runs the whole app.
- Data-source answers recorded: votes (House Clerk/Senate LIS/Congress.gov), money (FEC),
  lobbying (Senate LDA, OpenSecrets). Tests 67/67.

## [0.6.0] — 2026-06-13 — Bake-off, caching engine, optimizer, web presence, ads
A big build day: a second backend, the full caching architecture, an optimization function,
the Explore UI, web-presence research, and a benchmark harness. All green (TS 56/56 tests,
Rust↔TS conformance 4/4), pushed to `master`.

### Added — architecture & docs
- **`API_CONTRACT.md`** — the frozen v1 contract every backend must satisfy (byte-compatible
  JSON), so the web frontend can swap backends and the bench compares them fairly.
- **`CACHING_ARCHITECTURE.md`** — research-backed, multi-layer plan to eliminate read lag:
  L0 precomputed static → L1 edge cache w/ async stale-while-revalidate → L2 KV → L3 D1/R2 →
  L4 once-running ingest. New ideas: version-pointer indirection (immutable caching of mutable
  data), single-flight, Cache-Tags, 103 Early Hints. (L1 dynamic-SWR flagged "verify by curl".)
- **`PERSISTENT_SERVER_DEPLOYMENT.md`** — provider-portable escape hatch from Cloudflare
  (container + Redis/Postgres + any CDN), the two-level near/far cache, and the `Store` interface.

### Added — caching engine
- **Unified cache headers + ETag/304** (`src/http.ts`): `jsonCached` (public/SWR/stale-if-error),
  `jsonImmutable` (1-yr immutable), `jsonPointer`, `jsonError` (no-store). Fixed: `/api/members`
  and `/api/bills` previously set NO cache headers.
- **Version-pointer scheme**: `GET /api/latest` (tiny mutable pointer) + immutable
  `GET /api/v/{version}/{profile|members|bills}` (`Cache-Control: immutable`, 1 yr).
- **Ingest job** (`src/ingest.ts`) — the "runs once" backend: pulls → normalizes → stamps a
  `dataVersion` → writes a static **L0 snapshot tree**. Verified live (250 members, 50 bills).
- **Graceful `Store`** (`src/store.ts`): `MemoryStore` / Cloudflare-KV adapter / `getStore`
  fallback; `/api/profile` background-increments `views:{bioguide}` (waitUntil) → feeds the optimizer.

### Added — the optimization function
- **Cache-admission optimizer** (`src/optimize.ts`): exact **0/1 knapsack (DP)** — pick the
  profiles to pre-generate that maximize expected hits within a budget. Replaces the arbitrary
  `TOP_N`. Value = real view counts when available, else a transparent proxy. Tests prove it
  beats naive greedy.

### Added — the bake-off (two backends)
- **Rust backend** (`rust/`, std HTTP + serde_json, HTTP keep-alive) implementing the full
  contract; profile normalization + salary mirror the TS code; fixtures embedded.
- **`bench/`** — `conformance.ts` (Rust JSON must equal TS, 4/4), `load.ts` (p50/p95/p99 + rps),
  `run_all.sh` (orchestrates both). `src/api_server.ts` = the TS standalone server (also serves
  the static web client). Finding: caching dominates; the language gap is modest.

### Added — product
- **Explore directory + search** (`web/explore.html`) — browse all members, filter by
  name/state/party, click into a profile; profile pages link back.
- **Web-presence research** (`web/index.html`) — official site + social media (Twitter/Facebook/
  Instagram/YouTube) from the public @unitedstates dataset, keyed by bioguide.
- **Light ad slot** for free users (neutral zone; hidden by the `pp_remove_ads` / $0.99 model).

### Fixed
- Profile normalizer robust against real Congress.gov non-bill sponsored entries (no more
  `null undefined` rows); contract-stable for clean bills. Live `CONGRESS_API_KEY` verified.

### Tooling
- Rust 1.96 toolchain installed (was absent). `tsconfig` `allowImportingTsExtensions`+`noEmit`.
  npm scripts: `test`, `typecheck`, `api`, `bench`, `ingest`. `.dev.vars` (key) gitignored.

## [0.3.0] — 2026-06-09 — Federal directory, bills, contact & salary
### Added
- **`GET /api/members`** — the full "everyone in Congress" directory (Congress.gov, server-side).
- **`GET /api/bills`** — bills currently moving through Congress, most-recent-first.
- **Contact** on every profile — office address, phone, official website, photo (Congress.gov).
- **Salary** on every profile — the public congressional pay schedule (`src/salary.ts`):
  $174,000 rank-and-file; leadership tiers (Speaker, chamber leaders) mapped from titles.
- Demo fixtures for members & bills so the no-key deploy still demonstrates everything.
- Web viewer now shows the photo, salary, contact block, and a "Bills in Congress" section.

## [0.2.0] — 2026-06-09 — Shared backend API (multi-client keystone)
### Added
- **`GET /api/profile`** — Cloudflare Pages Function that pulls a member profile from
  Congress.gov **server-side**, so `CONGRESS_API_KEY` is never shipped to a client.
  Falls back to the bundled demo fixture when no key is set. This is the single shared
  backend the web, iOS (Swift), and Android clients all consume.
### Changed
- Web viewer fetches `/api/profile` (live or fixture), falling back to the static
  `profile.json` for the plain `npm run` flow. Output is HTML-escaped.

## [0.1.0] — 2026-06-04 — Phase 0: profile pipeline
### Added
- Congress.gov client (`src/congress.ts`) + profile normalizer (`src/profile.ts`).
- `npm run demo` (offline fixture) / `npm run demo:live` (real data) → writes `web/profile.json`.
- Minimal web viewer (`web/index.html`, served by `src/serve.ts`) with past/present/future tabs.
- Project scaffolding, ROADMAP, and the honest data-source reality check.

[0.7.0]: https://github.com/rled7/pocket-politics
[0.6.0]: https://github.com/rled7/pocket-politics
[0.3.0]: https://github.com/rled7/pocket-politics
[0.2.0]: https://github.com/rled7/pocket-politics
[0.1.0]: https://github.com/rled7/pocket-politics

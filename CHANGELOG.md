# Changelog

All notable changes to Pocket Politics. Format follows [Keep a Changelog](https://keepachangelog.com);
this project uses date-stamped milestones while pre-1.0. Each release also carries a **build number**
(`src/build.ts`, mirrored at `/api/version` and in the page footer) tracking the commit count at release.

## [0.16.0] — build 57 — 2026-06-13 — Defend yourself in civil court
### Added
- **Defend yourself** (`web/defend.html` + `defend.json`) — plain-language help for people sued without
  a lawyer: 6 first-steps (don't ignore it → file your Answer on time → show up), plus 12 official
  resources grouped into free legal aid, DIY forms & drafts (NY CourtHelp, federal court forms), and
  the rules/courts. Clear "not legal advice" disclaimer. Searchable. Linked from Home + site map.

## [0.15.0] — build 56 — 2026-06-13 — Government assistance / HRA hub
### Added
- **Get help** (`web/assistance.html` + `assistance.json`) — all social-services in one place: 24
  programs across cash/emergency, housing, food, health, energy, and family — each with what it is,
  who qualifies, **what to bring**, and exactly where to apply, with official links. Includes the
  **One-Shot Deal / emergency assistance** and NYC housing programs (CityFHEPS, NYCHA, Homebase) the
  user called out, plus benefit screeners (Benefits.gov, ACCESS HRA, myBenefits, 211). Searchable.
  Federal nationwide; NY/NYC detailed (first covered state). Linked from Home + site map.

## [0.14.0] — build 55 — 2026-06-13 — Plain-language glossary (legalese + plain English)
### Added
- **Glossary** (`web/glossary.html` + `glossary.json`) — 24 legal/legislative terms, each defined
  **twice** (plain English + legalese) with a link to the authoritative definition (Cornell Law's Wex).
  Searchable. Linked from Home and the site map. Foundation for later on-page term auto-definition.

## [0.13.0] — build 54 — 2026-06-13 — NY laws + Senate floor transcripts
### Added
- **New York laws** (`GET /api/ny/laws`) — the full codified body of NY law (137 chapters), searchable,
  each linking to the official nysenate.gov law text.
- **NY Senate floor transcripts** (`GET /api/ny/transcripts`) — records of floor discussion (kept since
  1993; 2,289 available), most recent first. Surfaces ACCESS now; plain-language AI summaries are the
  follow-on (#32, needs an AI step).
- Both added as sections on `web/ny.html`; `src/nystate.ts` extended with `getNyLaws` / `getNyTranscripts`
  (shared fixture loader). Verified live (137 laws, 2,289 transcripts). Tests 84/84.

## [0.12.0] — build 53 — 2026-06-13 — "Converge on ideas" black & white mode
### Added
- **Black & white mode** (`web/bw-mode.js`) — a persistent toggle (bottom-right ◑) that strips ALL
  color from the app, including party tones, so people weigh the *idea* rather than the side. A
  prototype now (user toggle, remembered in localStorage); designed to later auto-engage when a
  proposal/idea is the focus. Present on all pages. Fits the design system, which already avoids
  red/blue. Tests 82/82.

## [0.11.0] — build 52 — 2026-06-13 — New York State legislation (first state-level data)
### Added
- **New York State legislation** (`web/ny.html`, `GET /api/ny/bills`) via the NY Senate Open
  Legislation API — the **first state-level** coverage. Lists NY Assembly & Senate bills
  (most-recently-active first) with sponsor, status, summary, and a link to the official
  nysenate.gov page; searchable. Verified live: 25,307 bills in the 2025 session.
- `src/nystate.ts`: verified Open Legislation client (session math, fixture fallback) — the
  template the rest of the per-state work (#6/#25/#35) follows. Open Legislation also serves NY
  laws, session transcripts, committee agendas, floor calendars, and member rosters (next).
- Linked from Home → Explore and the site map. Tests 82/82.

## [0.10.0] — build 51 — 2026-06-13 — Lobbying on the profile, integration registry, build versioning
### Added
- **Lobbying disclosure on the member profile** — "Who's lobbying on their issues" (Senate LDA API,
  `GET /api/lobbying?q=&year=`). Searchable by issue or bill; shows **client → lobbying firm → issue →
  amount** with a link to each official filing. Seeded from the member's own policy area. Verified live
  (e.g. `climate` 2024 → 2,899 disclosed filings). Demo fixture (a real captured sample) when no key.
- **API integration registry** (`src/config.ts`) — one typed home for every key (Congress, FEC, Senate
  LDA, NY Open Legislation); secrets-safe `GET /api/integrations` (booleans only, never values) + a boot
  log line `integrations: congress✓ fec✗ lda✓ nyOpenLeg✓`. Keys stay in the gitignored `.dev.vars`.
- **Build versioning** — `src/build.ts`, `GET /api/version`, build tag in the footer + this entry.
### Changed
- Contact card text pinned to full-strength ink with underlined links (was hard to read).
### Honesty contract
- LDA lobbying is **issue-level, not keyed to an individual member** (`government_entities` is often
  empty and never names a member), and is kept **separate from FEC campaign money** — the UI never
  fuses them into one "influence" figure.
### Notes
- Keys registered this session: Senate LDA (lobbying) + NY Open Legislation (NY bills, laws, session
  transcripts, committee agendas, floor calendars, membership) — NY features scaffolded for a later
  release. New backlog (#28–#40) captured: assistance/HRA hub, events, multilingual, transcripts,
  glossary, pricing tiers, B&W "converge on ideas" mode, and more.

## [0.9.0] — 2026-06-13 — Sub-ms navigation: stale-while-revalidate cache + prewarm
### Added
- **`src/swr_cache.ts` — `SwrCache`**: the in-memory stale-while-revalidate tier that makes
  every cached API response serve at static-page speed (~1ms) instead of blocking on a live
  Congress.gov call. FRESH → serve instantly; STALE → serve the stale copy instantly **and**
  refresh in the background (single-flight, so revalidations never stampede the gov API); cold
  MISS is the only blocking path. Honors the `stale-while-revalidate` directive our responses
  already declared in Cache-Control but the local server previously ignored.
- **Boot-time cache warming** (`api_server.ts`): warms the common entry points (members + bills)
  immediately, then **background-fills all 537 member profiles** with bounded concurrency
  (`mapLimit`, 6-wide) so the slowest cold path (profile ≈ 2s) becomes instant within ~3 min of
  boot. A 4-minute refresh loop re-pulls cached keys before they go stale so data stays fresh.
  Disable with `PREWARM=0`.
### Performance (measured, live key)
- `/api/members` **848ms → ~6ms**, `/api/bills` **125ms → ~2ms**, `/api/profile` **2.2s → ~1ms**
  once warm. `X-Cache` header reports HIT / STALE / MISS / BYPASS.
### Preserved
- `no-store` paths and `/api/comments` (writes) remain uncached. Tests 67/67, typecheck clean.

## [0.8.0] — 2026-06-13 — "Take Action" (How-To v1)
### Added
- **`web/howto.html` — "Take Action"** page: an evergreen, location-agnostic guide to actually
  participating in government, grouped into four sections — *Participate today* (register/vote,
  find & contact reps, comment on bills & federal rules), *Run for office* (see what's open, file
  to run, register a campaign committee), *Get appointed or hired* (boards & commissions, USAJOBS,
  internships/fellowships), and *Build & organize* (ballot initiatives, nonprofits, PACs, local
  organizing). Each item links to the official place to do it (vote.gov, USA.gov, USAJOBS,
  regulations.gov, FEC, state election offices). Internal links route back into the app;
  external links open safely (`rel="noopener noreferrer"`).
- **Consistent top nav** across the site: the "Take Action" tab is now on `home`, `explore`, and
  `bills`; `explore.html` gained the shared `<nav>` it was previously missing.
### Notes
- This is How-To **v1** (evergreen + official links). Address-personalization ("how to run for
  *your* school board" → your district's filing office/deadlines) is the next iteration.

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

### Scope note (honesty)
- The new feature endpoints (`/api/votes`, `/api/comments`, `/api/money`) are **TypeScript-only**.
  The **Rust** backend remains the **core-contract reference** that proved the perf comparison;
  TS is the feature-complete production backend. The conformance gate covers the core contract.

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

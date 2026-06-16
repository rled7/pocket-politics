# Changelog

All notable changes to Pocket Politics. Format follows [Keep a Changelog](https://keepachangelog.com);
this project uses date-stamped milestones while pre-1.0. Each release also carries a **build number**
(`src/build.ts`, mirrored at `/api/version` and in the page footer) tracking the commit count at release.

## [0.35.0] — build 77 — 2026-06-16 — Security audit document (blue-team)
### Added
- **SECURITY.md** — a blue-team audit of the shipped surface: endpoint inventory, mitigations in place
  (secret hygiene, output encoding, CSP/headers, input validation + state allowlist, SSRF defense, rate
  limiting incl. the paid AI endpoint, PII minimization, moderation, path-traversal guard, minimal deps),
  plus a red-team threat list with TODOs for when accounts/payments/identity-verification land. The full
  #16 red/blue pass still runs after the feature set locks; this documents the current posture.

## [0.34.0] — build 76 — 2026-06-16 — Congressional Record (federal floor record)
### Added
- **Congressional Record** (`web/record.html`, `GET /api/record`, `src/record.ts`) — the official daily
  House & Senate floor record from Congress.gov (5,822 issues), most recent first, each linking to the
  official record. The federal parallel to the NY Senate transcripts. Verified live. Linked from Home,
  site map, HUD nav. This is the access half of #32; plain-language AI summaries layer on via the
  translator once `ANTHROPIC_API_KEY` is set. Tests 116/116.

## [0.33.0] — build 75 — 2026-06-16 — Passed-appropriations view + Trending surface
### Added
- **Budget: "passed / enacted this year"** — the budget & shutdown page now derives each appropriations
  bill's stage from its latest action (Enacted-into-law / Passed Senate / Passed House / In progress),
  shows a count of how many have passed, and groups passed/enacted bills above in-progress ones. (User
  request: list the appropriations bills that have passed so far this year.)
- **Trending surface** (`src/trending.ts`, `POST /api/track`, `GET /api/trending`) — the "observe what
  people engage with" half of #39: bill/member opens are tracked into a bounded popularity map, surfaced
  as a 🔥 Trending widget in the HUD rail. Rate-limited, validated, no key. The AI "reframe content"
  half waits for the Anthropic key. Tests 115/115.

## [0.32.0] — build 74 — 2026-06-15 — Rate limiting (cost/abuse protection)
### Security
- **Per-IP rate limiting** (`src/ratelimit.ts`) on all unauthenticated POST endpoints, **strictest on
  the paid `/api/translate`** (10/min) — closing the cost-DoS hole where someone could spam the AI
  endpoint and run up tokens. Also caps checkout (20/min), comments (20/min), reactions (60/min) with a
  `429 + Retry-After`. Verified: 10× `/api/translate` → 200, then 429. Part of #16. Tests 113/113.
- **#14 done** — the inline "OpenCase translation preview, no copy-paste" the user wanted is delivered
  natively by the bill translator (#7), no external dependency.

## [0.31.0] — build 73 — 2026-06-15 — Comment moderation (rules-based)
### Added
- **Comment moderation** (`src/moderation.ts`) — a no-key, rules-based first line of defense against the
  abuse the user called out: links/promotion, phone numbers, all-caps shouting, spammy character runs,
  and nonsense. Enforced at post time in `addComment` with a clear user-facing reason. A smarter AI
  topic-relevance pass can layer on later behind the Anthropic key. Part of #15. Tests 111/111.
### Note on #41 (stock trades)
- The free congressional stock-trade datasets (house/senate-stock-watcher S3) now return 403 — that data
  requires a paid source (Quiver/Capitol Trades). Flagged; not fabricated.

## [0.30.0] — build 72 — 2026-06-15 — Bill translator (AI) — scaffolded & cost-controlled
### Added
- **Bill translator** (`src/translate.ts`, `POST /api/translate`, UI on `web/bill.html`) — turns a bill's
  legalese into plain English, with key points shown in **both plain English and the original legal
  wording, side by side** (the #7 spec). Built on the Anthropic API; **activates the moment
  `ANTHROPIC_API_KEY` is set**, and degrades cleanly to "not enabled yet" otherwise (same honest pattern
  as Stripe). Verified: no-key path returns `enabled:false`, no fabrication.
- **Cost controls baked in** (always-on cost-optimizer): cheapest reliable model (Sonnet, override via
  `TRANSLATE_MODEL`), hard `max_tokens` cap, input-length cap, per-call usage logging, and — critically —
  a **per-bill cache** so each bill is translated once then served free forever (the token-saving core of
  pricing #38). Tests 107/107.
- `anthropic` registered in the integrations status.

## [0.29.0] — build 71 — 2026-06-15 — "My City" location-aware local dashboard
### Added
- **My City** (`web/mycity.html`) — a local heads-up set automatically from your device location (or an
  address): your representatives + quick routes to your state legislature, local-officials finder, local
  events, and assistance — all scoped to where you live. Location stays in the browser (saved locally,
  changeable anytime). Built on the existing Census geocoder. Closes #23.

## [0.28.0] — build 70 — 2026-06-15 — Laws, regulations & ordinances finder
### Added
- **Laws, regulations & ordinances** (`web/regulations.html` + `regulations.json`) — every layer of
  binding rules: federal statutes (our live bills + U.S. Code), federal regulations (eCFR,
  Regulations.gov, Federal Register), all-50-state legislation (our live data), state admin codes
  (NYCRR + finders), and local ordinances (Municode, American Legal, Code Publishing). Links into live
  data where we have it, authoritative full-text everywhere else. Closes #25.

## [0.27.0] — build 69 — 2026-06-15 — Civic events (filterable)
### Added
- **Civic events** (`web/events.html` + `events.json`) — town halls with your reps, elections &
  deadlines, public meetings, and ways to volunteer/organize — **filterable by category**. Each routes
  to the authoritative finder (Town Hall Project, Vote.gov, USA.gov, our calendars) since no single
  national events feed exists. Linked from Home, site map, HUD nav. Closes #29.

## [0.26.0] — build 68 — 2026-06-15 — Find every official (federal → ALJs)
### Added
- **Find every official** (`web/local.html` + `local.json`) — every layer of government from the
  President down to the administrative law judge who hears your parking ticket. Where clean data exists
  (federal Congress + all 50 state legislatures) we link straight to the people we already list; for
  county/city/local/judges — which have **no single national database** — we route to the authoritative
  finders (USA.gov, Ballotpedia, NACo, NYC OATH, NY DMV, NCSC) rather than fabricate. Honest "we list
  these / find yours" badges per level. Linked from Home, site map, and the HUD nav.
- Addresses #35 (officials at every level) and the intent of #19 (down to ALJs) via honest finder
  routing — no fake local data.

## [0.25.0] — build 67 — 2026-06-15 — Security hardening v1
### Security
- **Security headers on every response**: Content-Security-Policy (locks object/base/frame, restricts
  script/style/img/connect origins), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy`, and a `Permissions-Policy` (geolocation self-only; camera/mic off).
- **State param allowlist** (`isValidState`) — the `/api/state` jurisdiction is validated against the
  50 state names, so it can never inject into the upstream OpenStates URL (SSRF/param-injection defense).
- This is hardening **v1** (headers + input validation + audit of escaping/secret-safety). The full
  red/blue-team pass (#16) stays scheduled for after the feature set locks, per plan. Tests 104/104.

## [0.24.0] — build 66 — 2026-06-15 — Facebook-style HUD layout (progressive)
### Added
- **3-column HUD layout** (`web/app-shell.js` + `.appshell`/`.rail` styles) — on wide screens (≥1120px)
  the page gains a **left nav rail** (every section, so you never page-hop blindly) and a **right rail**
  that keeps relevant info ON the page: the next item in Congress + quick actions. The center reading
  column is unchanged. Below 1120px it collapses back to the clean single column, so mobile stays simple.
  Injected on every page as a progressive enhancement (content untouched, fully reversible). Closes #26.

## [0.23.0] — build 65 — 2026-06-14 — NY Senate floor calendars + committee agendas
### Added
- **NY Senate floor calendars** (`GET /api/ny/calendars`) and **committee agendas**
  (`GET /api/ny/agendas`) via Open Legislation — added as sections on `web/ny.html`. Calendars show
  the days bills are scheduled for the floor; agendas show committee meetings with bills considered.
  Verified live (68 calendars, 21 agendas). Completes the NY Open Legislation coverage (#33). Tests 102/102.

## [0.22.0] — build 64 — 2026-06-14 — Filibuster & cloture
### Added
- **Filibuster & cloture** (`web/filibuster.html`, `GET /api/cloture`) — the public record of what got
  filibustered, from the Senate's official roll-call vote menu. Cloture "Agreed to" = filibuster broken;
  "Rejected" = filibuster held. Shows session stats (total cloture votes, broken vs held) + recent
  cloture votes with tally, subject, and a roll-call link. No API key needed (public senate.gov XML).
  Verified live (47 cloture votes this session: 35 broken / 12 held). Linked from Home + site map.
- `src/cloture.ts`: fetches + parses the Senate vote menu XML, fixture fallback. Tests 100/100. Closes #22.

## [0.21.0] — build 63 — 2026-06-14 — Stripe payments scaffold + FEC live
### Added
- **Stripe payments** (`src/payments.ts`, `web/pricing.html`, `POST /api/checkout`, `GET /api/pricing`)
  — hosted Checkout (no card data touches our server). Three-sided pricing page: citizen tiers
  (self-serve), non-profit + politician sides (verified-reach, early-access CTAs with the Meta-undercut
  pitch). Activates when `STRIPE_SECRET_KEY` + Price IDs are set; until then the API cleanly reports
  "not configured." Pure helpers unit-tested (no network).
- **FEC campaign finance is now live** — the key is wired, so the profile's *Campaign finance* card
  shows real raised/spent/cash-on-hand instead of demo data.
- Tests 98/98, typecheck clean.

## [0.20.0] — build 62 — 2026-06-14 — Budget & shutdown watch
### Added
- **Budget & shutdown watch** (`web/budget.html`, `GET /api/budget`) — the appropriations bills
  actually moving in Congress + the authoritative **Appropriations Status Table** and committee
  trackers + a plain "how a shutdown happens" explainer. No fake countdown (funding deadlines aren't a
  clean data field); the official status table is flagged as the source of truth. Verified live (3
  appropriations bills). Linked from Home + site map. Closes #20.
- `src/budget.ts`: scans the recent bill feed for appropriations (excludes "disapproval" false-matches),
  fixture fallback.
### Direction
- Pricing (#38) is now a **3-sided model**: citizens (tiers) · non-profits (connect with constituents) ·
  politicians (verified-district reach). Tests 92/92.

## [0.19.0] — build 61 — 2026-06-14 — "Ideas" section (redesigned) + grayscale fix
### Changed / Fixed
- **Replaced the global black-&-white toggle** (a misread of the feature, and it had no off-switch)
  with the intended **"Ideas" section** (`ideas.html`): a proposal is shown as **just the idea** —
  no name, no party, no color — so people judge it on the merits. React 👍/👎/😐 first; only then can
  you **"reveal who proposed it."** The goal: debate the idea, not the side it came from.
- `bw-mode.js` is now a one-time **migration** that clears the stuck global-grayscale flag, so anyone
  who got trapped returns to normal color on next load.
### Direction captured (user pitch — politician revenue side)
- The business model now centers on **ID-verified registered voters**: tasks #15 (verified-voter
  accounts), #38 (two-sided pricing — citizens + politicians undercutting Meta), #45 (politician →
  district-targeted constituent messaging), #46 (identity-verification engine: gov ID → voter file →
  district). Pitch: "100% ID-verified registered voters inside your district boundaries."

## [0.18.0] — build 60 — 2026-06-14 — Congressional calendar (front and center)
### Added
- **Congressional calendar** (`web/calendar.html`, `GET /api/calendar`) — upcoming committee
  hearings & markups, soonest first, with committee, chamber, time, and room. Plus authoritative
  official-schedule links (House floor, Senate floor, Congress.gov committee meetings, days in
  session). Front-and-center: a calendar banner on Home (previewing the next meeting) + a top-nav
  link. Verified live (12 upcoming meetings).
- `src/calendar.ts`: fetches the committee-meeting list + bounded detail fetches, filters to
  **today-forward** dates (the list itself includes recently-edited PAST meetings), sorts soonest
  first. Sends an explicit User-Agent (api.data.gov blocks default agents). Fixture fallback.
### Rate-limit safeguard
- The calendar is N+1 (list + ~30 detail fetches), so it uses a long TTL (sMaxAge=3600) and is
  excluded from the background refresh loop. Tests 89/89.

## [0.17.1] — build 59 — 2026-06-13 — Fix: lobbying source link always shows
### Fixed
- The profile's "Who's lobbying on their issues" panel only rendered the **Official Senate LDA search
  link** in the loaded state — so when a member had no seed issue, or the lookup errored, the source
  link was missing. It now always shows (before a search, on empty results, and on error).
### Noted
- New task #44: make lobbying genuinely **member-specific via an AI step** (parse filings vs. the
  member's own bills/issues, summarize "what they're trying to do") — the honest fix for LDA being
  issue-level, not member-keyed. Needs an AI provider (cost decision) + per-member caching.

## [0.17.0] — build 58 — 2026-06-13 — All 50 states (OpenStates) — the big unlock
### Added
- **Your state government** (`web/states.html`, `GET /api/state?state=`) — pick any of the 50 states to
  see its **legislators** (by chamber, with party/district) and the **bills** moving through its
  legislature. Live via OpenStates v3. Verified (Vermont → 50 legislators, 15 bills). Linked from Home
  + site map. Closes #6; advances #35 (state officials).
- `src/openstates.ts`: rate-limit-aware client (free tier = 500/day, 1/sec) — on-demand only, two
  SEQUENTIAL calls per state, fixture fallback.
### Rate-limit safeguards
- State responses use a long cache TTL (`sMaxAge=1800`) and are **excluded from the background refresh
  loop**, so cached states are never re-pulled on a timer — protecting the 500/day quota.

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

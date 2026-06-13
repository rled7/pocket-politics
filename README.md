# Pocket Politics

**Every politician, transparent — in your pocket.** A civic-transparency platform that
turns the public record into a clear picture of who represents you: their full
legislative history, the bills moving through government, how to reach them, what they
make — and how *you* can take part. Sourced from official, free government APIs and never
editable by the politicians themselves.

> **Why:** the data is already public, but it's scattered across a dozen government
> sites in formats nobody reads. Pocket Politics **aggregates and presents** it — that's
> the product. One place, plain language, every level of government, plus a "How To"
> guide for actually participating.

---

## What it is (and where it's going)

A **multi-platform app on a single shared backend**:

```
                  ┌──────────── Web  (this repo, /web) ────────────┐
  Congress.gov ──▶│  Cloudflare Pages Functions  (/functions/api)  │──▶ iOS — Swift / SwiftUI   (planned)
  + public data   │   /api/profile   /api/members   /api/bills      │──▶ Android — Kotlin/Compose (planned)
                  └─────────────────────────────────────────────────┘
```

The API key lives **only** on the server — no client ever sees it. The web app, the iOS
(Swift) app, and the Android app all consume the same JSON. Build the data layer once,
ship it everywhere.

## What works today

- **Explore directory + search** — browse all current members of Congress, filter by
  name / state / party (House/Senate), click into any profile.
- **Member profiles** — name, party, state, chamber, **photo**, **salary**, **contact**,
  full **sponsored-legislation record**, and a **Web presence** card (official site +
  Twitter/Facebook/Instagram/YouTube, researched from the public @unitedstates dataset).
- **`/api/members`**, **`/api/bills`**, **`/api/profile`**, plus the version-pointer
  caching scheme (`/api/latest` + immutable `/api/v/{version}/…`).
- **Aggressive caching** to eliminate read lag — see [`CACHING_ARCHITECTURE.md`](./CACHING_ARCHITECTURE.md):
  edge cache + async SWR, immutable version-addressed payloads, a once-running **ingest** job
  that pre-generates static L0 snapshots, and a **cache-admission optimizer** (0/1 knapsack)
  that bakes the highest-value profiles within a budget.
- **Two backends, one contract (the bake-off)** — identical behavior in **TypeScript** and
  **Rust**, proven by a conformance gate and benchmarked head-to-head. See below.
- **Light ad slot** for free users (the `$0.99` remove-ads model), in a neutral zone.
- **Works with or without a key** — set `CONGRESS_API_KEY` for the live record; without
  one, every endpoint serves a clearly-labeled demo fixture so the site always works.

## Two backends — the bake-off

The **core** [`API_CONTRACT.md`](./API_CONTRACT.md) (`/api/members`, `/api/bills`,
`/api/profile`, `/api/latest` + immutable `/api/v/…`) is implemented twice and compared:

| | TypeScript | Rust |
|---|---|---|
| Server | `src/api_server.ts` (Cloudflare Functions in prod) | `rust/` (`pp-server`, std HTTP + serde_json) |
| Run | `npm run api` (:8788) | `cd rust && cargo run --release` (:8787) |
| Scope | **feature-complete production backend** (+ votes, comments, money) | **core-contract reference** (proves the perf comparison) |

```bash
npm run bench        # conformance gate (core JSON must match) + load test, TS vs Rust
```

Finding (see [`bench/README.md`](./bench/README.md)): on this cache-frontable read workload
the language gap is modest — the **caching** dominates. The bake-off's purpose (compare
language perf on the read path) is met by the core contract; the newer feature endpoints
(`/api/votes`, `/api/comments`, `/api/money`) are **TypeScript-only**, which is the production
backend. The web frontend points at the TS backend; Rust is the comparison reference.

See [`CHANGELOG.md`](./CHANGELOG.md) for history and [`PROJECT_TRACKER.md`](./PROJECT_TRACKER.md)
for the **full plan** — every level (federal → state → city), the data-source reality for
each feature, and the **"How To" civic-action guide** (open government positions, how to
apply, how to run for office, how to start your own town, and more).

## The API

| Endpoint | Returns |
|---|---|
| `GET /api/profile?bioguide=O000172` | One member: bio, salary, contact, sponsored record |
| `GET /api/members?limit=250` | Directory of current members of Congress |
| `GET /api/bills?limit=20` | Bills currently in Congress, most recent first |

Every response includes `live: true\|false` (live data vs. demo fixture). Example:

```bash
curl https://pocketpolitics.example/api/profile?bioguide=O000172
```

## Data sources (all free & official)

| Data | Source |
|---|---|
| Members, bills, sponsored legislation, contact | **Congress.gov API** — `api.congress.gov` ([free key](https://api.congress.gov/sign-up/)) |
| Contact + social (richer) | **@unitedstates/congress-legislators** (public GitHub dataset) |
| Salary | Public schedule — CRS *"Salaries of Members of Congress"* / 2 U.S.C. §4501 |
| Voting records *(next)* | House Clerk roll-call XML + Senate LIS XML |
| State | **OpenStates / Plural API** (all 50 legislatures) |
| City | Legistar / Granicus APIs + per-city open-data portals |

## Quick start

```bash
npm install

# Offline — builds a profile from fixtures, then serves the viewer at :5174
npm run demo
npm run serve

# Live data — get a free key at api.congress.gov/sign-up
CONGRESS_API_KEY=xxxx npm run demo:live
```

Run the **full app locally** (web client + live API in one server):

```bash
CONGRESS_API_KEY=xxxx npm run api      # http://localhost:8788  (lands on the directory)
```

Other commands:

```bash
npm test          # TypeScript unit suite (56 tests)
npm run typecheck # tsc --noEmit
npm run ingest    # run the ingest job → static L0 snapshots in dist/
npm run bench     # the bake-off: conformance + load test, TypeScript vs Rust
```

## Deploy

Full turnkey steps in **[`DEPLOY.md`](./DEPLOY.md)** (Cloudflare Pages: set the
`CONGRESS_API_KEY` secret, bind `POCKETPOL_KV`, schedule ingest, turn on Tiered Cache).
`wrangler.toml` holds the Pages config + KV binding. The persistent-server path (off
Cloudflare) is in [`PERSISTENT_SERVER_DEPLOYMENT.md`](./PERSISTENT_SERVER_DEPLOYMENT.md).

## Project structure

```
src/         http.ts (caching) · handlers.ts (shared data layer) · congress.ts · profile.ts ·
             salary.ts · version.ts · store.ts · optimize.ts (knapsack) · ingest.ts ·
             api_server.ts (TS standalone server) · demo.ts · serve.ts · http.test.ts
functions/   api/{profile,members,bills,latest}.ts · api/v/[version]/…   (Cloudflare Pages Functions)
rust/        src/main.rs (Rust backend — bake-off contender) · Cargo.toml
bench/       conformance.ts · load.ts · run_all.sh · README.md   (the bake-off harness)
web/         explore.html (directory+search) · index.html (profile + web presence)
fixtures/    demo data so the no-key build still works
docs:        API_CONTRACT · CACHING_ARCHITECTURE · PERSISTENT_SERVER_DEPLOYMENT ·
             BLUEPRINT · ROADMAP · PROJECT_TRACKER · CHANGELOG · DEPLOY
```

## Docs

- [`PROJECT_TRACKER.md`](./PROJECT_TRACKER.md) — the thorough plan: all levels, every
  feature, the data-source reality, and the full **How To** civic-action catalog.
- [`CHANGELOG.md`](./CHANGELOG.md) — what shipped, when.
- [`ROADMAP.md`](./ROADMAP.md) — long-range vision (the three-sided civic marketplace).

## Integrity

Built on public records. Politicians can annotate but **never edit** the official record —
votes and legislation always come from independent government sources.

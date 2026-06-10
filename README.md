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

## What works today (`v0.3.0`)

- **Member profiles** — name, party, state, chamber, **photo**, **salary**, **contact**
  (office, phone, website), and full **sponsored-legislation record**.
- **`/api/members`** — the whole "everyone in Congress" directory.
- **`/api/bills`** — bills currently moving through Congress.
- **Works with or without a key** — set `CONGRESS_API_KEY` for the live record; without
  one, every endpoint serves a clearly-labeled demo fixture so the site always works.

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

To run the **full backend (Functions + web)** locally exactly as it deploys:

```bash
npx wrangler pages dev web   # serves /web + auto-loads /functions
# → http://localhost:8788  (set CONGRESS_API_KEY in the Pages env for live data)
```

## Deploy (Cloudflare Pages)

1. Connect this repo as a Cloudflare **Pages** project.
2. **Build command:** *(none)* · **Build output directory:** `web` · Functions are
   auto-discovered from `/functions`.
3. Add an environment variable **`CONGRESS_API_KEY`** (free, from Congress.gov).
4. Attach your domain. The same backend now serves the web app and, later, the
   iOS/Android clients.

## Project structure

```
src/         congress.ts (API client) · profile.ts (normalizer) · salary.ts · demo.ts · serve.ts
functions/   api/profile.ts · api/members.ts · api/bills.ts   (Cloudflare Pages Functions = the backend)
web/         index.html  (the web client; static)
fixtures/    demo data so the no-key build still works
```

## Docs

- [`PROJECT_TRACKER.md`](./PROJECT_TRACKER.md) — the thorough plan: all levels, every
  feature, the data-source reality, and the full **How To** civic-action catalog.
- [`CHANGELOG.md`](./CHANGELOG.md) — what shipped, when.
- [`ROADMAP.md`](./ROADMAP.md) — long-range vision (the three-sided civic marketplace).

## Integrity

Built on public records. Politicians can annotate but **never edit** the official record —
votes and legislation always come from independent government sources.

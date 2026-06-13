# Pocket Politics — Project Tracker

> Forward-looking companion to `README.md` (what it is / how to run), `CHANGELOG.md`
> (what shipped when), and `ROADMAP.md` (the long-range vision). This file is the
> **thorough plan of everything Pocket Politics can offer** — every level of government,
> the honest data-source reality for each feature, and the full **"How To" civic-action
> catalog**.

**Status:** `v0.3.0` · backend + web client working on demo data · not yet deployed.
**Last updated:** 2026-06-10.

---

## 1. Architecture — one backend, three clients

```
                 ┌─────────── Web (this repo, /web) ─────────┐
 Gov data ──────▶│  Cloudflare Pages Functions (/functions)  │──▶ iOS  (Swift / SwiftUI)   [planned]
 (fed/state/city)│  /api/profile  /api/members  /api/bills … │──▶ Android (Kotlin/Compose) [planned]
                 └────────────────────────────────────────────┘
```

The API key lives **only** on the server. Every client renders the same JSON — build the
data layer once, consume everywhere.

---

## 2. Build state (updated 2026-06-13, `v0.6.0`)

**Data + API**
| Area | State | Notes |
|---|---|---|
| Congress.gov client | ✅ | `src/congress.ts` — member, sponsored, members list, bills |
| Profile normalizer | ✅ | `src/profile.ts` — record + contact + salary; robust vs non-bill entries |
| Shared data layer | ✅ | `src/handlers.ts` — getProfile/getMembers/getBills (parity spec for Rust) |
| `/api/profile` `/api/members` `/api/bills` | ✅ | server-side, fixture fallback, validated, cached |
| `/api/latest` + `/api/v/{version}/…` | ✅ | version-pointer; immutable version-addressed payloads |
| Salary | ✅ | `src/salary.ts` — public schedule + leadership tiers |
| Live key | ✅ | `CONGRESS_API_KEY` verified live (gitignored `.dev.vars`) |

**Caching engine (eliminate lag)**
| Area | State | Notes |
|---|---|---|
| Cache headers + ETag/304 | ✅ | `src/http.ts` — async SWR + stale-if-error; immutable; pointer |
| Ingest / L0 pre-generation | ✅ | `src/ingest.ts` — static snapshot tree; verified live |
| Graceful Store (L2) | ✅ | `src/store.ts` — Memory/KV/getStore; view instrumentation |
| Cache-admission optimizer | ✅ | `src/optimize.ts` — 0/1 knapsack; demand-driven via view counts |
| Tiered Cache / Cache Reserve / KV binding | ⬜ | needs the Cloudflare account (DEPLOY.md) |

**The bake-off (two backends, one contract)**
| Area | State | Notes |
|---|---|---|
| API contract | ✅ | `API_CONTRACT.md` (frozen v1) |
| TypeScript backend | ✅ | `functions/` (Pages) + `src/api_server.ts` (standalone + static) |
| Rust backend | ✅ | `rust/` — std HTTP + serde_json, keep-alive |
| Conformance gate | ✅ | `bench/conformance.ts` — Rust JSON == TS (4/4) |
| Benchmark harness | ✅ | `bench/load.ts` + `bench/run_all.sh` |

**Product / web**
| Area | State | Notes |
|---|---|---|
| Profile viewer | ✅ | `web/index.html` — photo, salary, contact, record, web presence |
| Explore directory + search | ✅ | `web/explore.html` — browse 250, filter, click-through |
| Web-presence research | ✅ | official site + socials (@unitedstates dataset) |
| Ad slot (free-user revenue) | ✅ | `web/explore.html` — neutral zone; `$0.99` remove-ads model |
| Deploy | ⬜ | Cloudflare Pages — see `DEPLOY.md` (needs the account) |
| iOS (Swift) / Android | ⬜ | native clients on the same API (future) |

---

## 3. Coverage plan — every level of government

### Federal — `in progress` (the current focus)
- ✅ Members directory, profiles, contact, salary, bills in Congress, sponsored record.
- 🟡 **Voting record** — every bill a member voted on (House Clerk roll-call XML + Senate
  LIS XML; Congress.gov vote endpoints). *ProPublica's API was sunset in 2024 — we assemble.*
- 🟠 **Schedule/events** — committee & floor schedules are API'd (Congress.gov
  `/committee-meeting`, docs.house.gov); personal appearances/town halls are not.
- 🔴 **Staff/team + pay** — House/Senate Statement of Disbursements (semi-structured).
- 🟡 **Money trail** — lobbying & funding (Senate LDA database + OpenSecrets).

### State — `planned`
- **OpenStates / Plural API** — bills, legislators, votes, committees for all 50 states.
- Governor + statewide offices, state agencies, ballot measures.
- Data source per state varies; OpenStates normalizes most of it.

### City / local — `planned` (hardest, most valuable)
- **Legistar / Granicus APIs** (many city councils run these), municipal open-data portals,
  county clerk sites. Per-city ingestion; start with the user's home cities.
- Mayor + council, school boards, special districts, local ballot measures, meeting agendas.

---

## 4. Feature → data source map (the honest reality)

| Feature | Source (free/public) | Status |
|---|---|---|
| Bills currently in Congress | Congress.gov `/bill` | ✅ done |
| Everyone in Congress + profiles | Congress.gov `/member` (+ @unitedstates legislators) | ✅ done |
| Contact / where to find them | Congress.gov member detail (+ legislators-social-media) | ✅ done (socials TODO) |
| Salary | Public schedule (CRS / 2 U.S.C. §4501) | ✅ done |
| Every vote a member cast | House Clerk + Senate LIS roll-calls | 🟡 next |
| Events / schedule | Committee & floor schedules (Congress.gov) | 🟠 partial |
| Staff & their pay | House/Senate disbursements | 🔴 later |
| Lobbying money trail | Senate LDA + OpenSecrets | 🟡 planned |
| State bills/legislators/votes | OpenStates / Plural | ⬜ planned |
| City council/agendas/meetings | Legistar / Granicus + open-data portals | ⬜ planned |

---

## 5. The "How To" — civic-action catalog

> A first-class section of the app: not just *who governs you*, but **how to take part**.
> Everything you can actually do in government, with the official where-to-go for each.
> (Build order: start with the evergreen guides + official links, then personalize by the
> user's address so every item is specific to their districts.)

### A. Participate (every voter, today)
- **Register to vote / check your registration** — vote.gov + each state's election office.
- **Find your representatives by address** — all levels, federal → city (the core personalization).
- **Contact your reps that actually works** — office lines, contact forms, district offices, scripts.
- **Find & attend public meetings** — council/committee/school-board agendas + how to speak.
- **Submit public comment** — on federal rules (regulations.gov) and on state/local bills.
- **Track a bill / get alerts** — follow a bill through its whole lifecycle.
- **Find your polling place, deadlines & what's on your ballot.**

### B. Run for office (open positions + how to file)
- **What positions are open & up for election** — federal (House, Senate, President), state
  (governor, legislature, AG, secretary of state, judges), county (commissioner, sheriff,
  clerk, DA), city (mayor, council), **school boards**, and **special districts** (water,
  fire, utility, transit) — the dozens of local seats people never realize are elected.
- **Where & how to apply/file to run** — your state/county **election office**: filing
  windows, fees, signature/petition requirements, ballot-access rules.
- **How to run, step by step** — eligibility check → file candidacy → register a campaign
  committee (FEC for federal, state agency for state/local) → campaign-finance rules →
  get on the ballot → required disclosures.
- **Deadlines calendar** — filing & election dates for the user's jurisdictions.

### C. Get appointed or hired into government
- **Appointed boards & commissions** — planning, zoning, library, parks, ethics, etc.; how
  to apply through your city/county/state (most have open seats and an application form).
- **Government jobs** — federal via **USAJOBS**, plus state & local civil-service portals;
  how to apply and what to expect.
- **Internships & fellowships** — congressional/state-legislature internships, civic fellowships.

### D. Build & organize
- **Start your own town (incorporate a municipality)** — the real path: feasibility/fiscal
  study → resident petition → county/state (LAFCO-style) review → charter & vote →
  incorporation. Varies by state; link the user's state statute + county process.
- **Start a ballot initiative / referendum** — petition thresholds, signature gathering,
  filing with the election office.
- **Start a nonprofit or civic org** — 501(c)(3)/(c)(4) basics, state incorporation, EIN.
- **Form a PAC** — when/why, and how to register (FEC/state).
- **Organize locally** — neighborhood associations, community boards, mutual-aid/issue groups.

> Each "How To" item ships as: a plain-language guide + the **official link/process for the
> user's exact location** (so "how to run for school board" resolves to *their* district's
> filing office, deadlines, and requirements). Sources: vote.gov, USA.gov, USAJOBS,
> regulations.gov, FEC, state election offices, county clerks, and city portals.

---

## 6. Next up
1. **Voting record** → the "Present · votes" tab (House/Senate roll-calls).
2. **Member socials** (@unitedstates legislators-social-media) + **directory UI** (browse all members).
3. **Deploy** to Cloudflare Pages (`CONGRESS_API_KEY` + domain).
4. **"How To" v1** — ship the evergreen guides + official links; then address-personalize.
5. **State level** (OpenStates), then **city** (Legistar).
6. **Native clients** — SwiftUI (iOS) + Compose (Android) on the same API.

## 7. Open decisions
- Address → districts: which geocoder (Census Bureau geocoder is free) for "your reps / your races."
- The 3-sided marketplace (voters / politicians / nonprofits) — see `ROADMAP.md`; the
  public-data + How-To product must be valuable to **voters alone** first.

# PHASES.md — Pocket Politics

> **Plan of record** (from build 96). Supersedes the task list in `REMAINING.md`; every open item
> there is mapped to a task below (`#NN` = the old tracker number).
>
> Builds 1–95 already shipped the federal/state/local data app, civic guides, bill comments and
> reactions, the caching engine, and the TypeScript-vs-Rust bake-off. See `DONE.md` and
> `CHANGELOG.md`. This plan covers what comes next: decoupling the platform, then the new
> **people's ideas** feature (post ideas you want government to act on, like and comment) and
> **profiles with overlapping affiliations** (unions, tenant associations, town halls, districts).

## Target architecture

```
apps/
  api/        TypeScript backend: ONE Hono app, two entry points
              ├─ worker.ts  → Cloudflare Workers (+ static assets, KV, Hyperdrive)
              └─ node.ts    → any container host (persistent server, SWR memory cache)
  web/        existing static web client (33 pages), migrated gradually
  mobile/     Expo app (iOS + Android, optional web), replaces planned Swift + Kotlin apps (Phase 3)
  api-rust/   Rust core-contract reference (frozen: no new endpoints, conformance gate only)
packages/
  db/         PostgreSQL + PostGIS schema, migrations, SQL tests
  shared/     OpenAPI-generated types + API client (Phase 1.4)
tools/
  bench/      conformance gate + load tests
infra/        Terraform: Cloudflare + Neon (Phase 1.6)
```

**Decoupling rules** (apply to every task):
1. App code never imports a host API directly. Workers- or Node-specific code lives only in the
   two entry files. No `node:fs` or `process.env` reads inside app modules; config is injected.
2. Every outside service sits behind an interface the app owns: Store, Database, Geocoder, each
   civic data source, Email, Identity verification, Payments, AI. Swapping a vendor = a new adapter.
3. Clients depend on the OpenAPI contract, never on backend internals.
4. Database stays plain PostgreSQL + PostGIS. No provider-only features in core logic.
5. Infrastructure lives in Terraform.

Tasks are atomic, sized for one subagent each, and done in order. A phase starts only when the
previous phase's exit criteria are met and logged in `TRACKER.md`.

---

## Phase 1 — Foundation (restructure + decouple, no new user features)

| # | Task | Deliverable | Acceptance |
|---|------|-------------|------------|
| 1.1 | Monorepo layout | Turborepo + pnpm workspace in the target layout above; root `turbo` scripts for `typecheck` / `test`; CI on pnpm + turbo; `wrangler.toml` and Pages Functions import paths updated so the current deploy path still works | **No behavior change.** All 123 tests pass; typecheck clean; Rust builds and passes the conformance gate; local server answers the 67-request parity capture identically |
| 1.2 | One router on Cloudflare Workers | Every API route in one Hono app (`apps/api/src/app.ts`) built by `createApp({ config, store, ... })`; `worker.ts` (Workers + static assets + KV) and `node.ts` (Node server keeping the SWR memory cache, prewarm and refresh loop); `functions/` deleted; `wrangler.toml` moved from Pages to Workers; fixtures imported as modules (no `node:fs` at runtime); config from Workers env or `process.env` via one loader; the same security headers and `/` → home landing on both hosts; route tests via `app.request()` for **every** route, including comment and reaction writes | Fixes the 18 endpoints missing on Cloudflare and the comment-argument bug. Parity capture matches the build-95 baseline; route tests cover every route in the router; `wrangler deploy --dry-run` bundles; typecheck covers all of `apps/api` |
| 1.3 | Adapters + upstream resilience | Interfaces for Geocoder, each civic data source, Email, IDV, Payments, AI (Email/IDV interface-only); one shared upstream fetch wrapper with timeout, retry with exponential backoff + jitter, and a per-upstream circuit breaker; existing fixture/stale fallbacks preserved | Tests: timeout fires; retries capped; breaker opens after N failures and half-opens; one upstream down never fails unrelated routes |
| 1.4 | API contract + shared client | Route schemas (zod) → generated `openapi.json`; `packages/shared` with generated types + typed client; contract test that every router route is in the spec and vice versa; **Postman collection generated from the spec** (committed, regenerated in CI) | CI fails on spec drift; Postman collection imports and runs against the local server |
| 1.5 | PostgreSQL foundation | Neon project with PostGIS (needs Rene's Neon account + connector); plain-SQL migrations with a runner; `packages/db` 001 schema as the first migration; Database interface with Hyperdrive (Workers) and direct pooled connection (Node) adapters; CI job with a PostGIS service container running `affiliations_test.sql` | Migrations up/down clean; 20/20 SQL tests pass in CI; app connects on both hosts |
| 1.6 | Terraform | `infra/`: Cloudflare (Worker, routes, KV, Hyperdrive) + Neon (project, branches); remote state; secrets out of state | `terraform plan` clean against a fresh account; README runbook |
| 1.7 | District boundary import | Loader for Census TIGER/Line (US House, NY Senate, NY Assembly) + NYC Planning (council, community districts) into `districts` + `district_boundaries`; reproject to SRID 4326, `ST_MakeValid`, source tag | Fixed NYC test addresses resolve to exactly one district per type; re-run is idempotent |

**Exit:** one codebase deploys to Workers or a container unchanged; every route is tested;
Postgres is live with the affiliation schema; infra is code.

---

## Phase 2 — Core logic (accounts + people's ideas engine, API only)

| # | Task | Deliverable | Acceptance |
|---|------|-------------|------------|
| 2.1 | Accounts + auth (#15) | Sign-up/sign-in, email verification (Email adapter), sessions, roles; per open decisions 1 and 3 | Auth tests: happy path, bad creds, expired/replayed tokens; rate-limited |
| 2.2 | Ideas CRUD | Create/read/edit/soft-delete ideas; title/body limits; category; `community_id` scope (NULL = public board) | Only active members post to a community; edit locked at 25 likes; author-only edit |
| 2.3 | Idea likes | Toggle like; one per user per idea; counter updated in the same transaction | 20 concurrent toggles end consistent; count = rows |
| 2.4 | Comments in Postgres | One comments table for ideas **and** bills (target type + id); one-level replies; existing KV bill comments migrated; rules-based moderation reused | Thread integrity; tombstones keep replies; migration script is idempotent |
| 2.5 | Ranking + feeds | Hot score (`log10(likes+1) + age/45000`, recomputed on like), New, Top (day/week/all); cursor pagination on `(score, id)` | No duplicates/skips while scores shift; ranking examples documented |
| 2.6 | Similar-ideas check | `pg_trgm` title similarity at post time; top 3 above threshold | Near-duplicate surfaces original; unrelated returns none |
| 2.7 | Affiliation API | Set/move residence (Census geocoder → `move_residence`, street string discarded); join/leave orgs (open vs approval); visibility + stats consent; `/me/communities`, `/me/representatives`; officials seeded from Congress.gov + OpenStates | Mirrors SQL tests T1–T19; raw address never stored or logged |
| 2.8 | KV writes to Postgres | Bill reactions, trending pings and profile-view counters move off KV (racy read-modify-write; free plan allows only 1,000 KV writes/day) to Postgres, with counters batched; KV becomes cache-only | Same API responses; concurrent reactions consistent; no KV writes on the request path |

**Exit:** full API test suite green; every new route in the OpenAPI spec.

---

## Phase 3 — Integration (screens)

| # | Task | Deliverable | Acceptance |
|---|------|-------------|------------|
| 3.1 | Expo app shell | `apps/mobile`: Expo Router, typed client from `packages/shared`, auth session, design tokens, safe-area/keyboard baseline; web output per open decision 5 | Runs on iOS + Android simulators; no inline colors |
| 3.2 | Ideas feed + post flow | Hot/New/Top feed, infinite scroll, post flow with similar-ideas step (skippable), drafts survive back-navigation | Empty/error/loading states; works on mobile + web |
| 3.3 | Idea detail | Likes (optimistic, clean rollback), comments, replies | Rollback on API failure without count flicker |
| 3.4 | Accounts + profile screens | Sign up/in, profile, my ideas/comments, settings | Session survives restart |
| 3.5 | Communities + representatives | Optional address step; My communities (federal/state/local + orgs); who represents me; community idea boards; org join; visibility toggles | Skipping address still works; private memberships never shown to others |
| 3.6 | Ideas page merge | Existing web Ideas page (anonymized bills) gains a "From people" tab next to "From Congress" | Both tabs share reaction/like UI patterns |
| 3.7 | Polish | Haptics, transitions, dark-mode audit, keyboard/safe-area audit | EDGE_CASES UI checklist ticked |

**Exit:** register → post idea → another account likes + comments → feed reorders, on mobile and web.

---

## Phase 4 — Advanced

| # | Task | Deliverable | Acceptance |
|---|------|-------------|------------|
| 4.1 | Report + moderation queue | Reports on ideas/comments; moderation actions with audit log | 50 reports never auto-remove; every action audited |
| 4.2 | Admin panel | Moderator UI for queue, content, actions | Moderator role required |
| 4.3 | Duplicate merge | Merge idea B into A; likes unioned by user; comments re-parented | User who liked both counts once |
| 4.4 | Notifications | Push + in-app for likes/comments on your ideas; batching; opt-outs | No storms; opt-outs respected |
| 4.5 | Org pages + officer tools | Claim/verify org pages; officers approve joins, mark `org_verified`; overlap stats via `community_overlap` (k-threshold) | Officers can't see private members; below-k never shown |
| 4.6 | Civic data refresh jobs | Scheduled Worker: redistricting loader + chunked resync; officials/terms after elections and vacancies | 100k synthetic users resync without long locks |
| 4.7 | Key-gated features | As keys arrive, one verified live before the next: #7 translator → #31 i18n → #32 summaries → #44 lobbying AI; #38 Stripe tiers; #41 influence patterns; #27 portraits | Each verified live on one real record before building the next |
| 4.8 | Verified constituents (#46 → #45) | IDV vendor + NY voter-file legal review first; then "verified constituent" badge and district-targeted messaging | Legal review signed off before any build |
| 4.9 | Election integrity (#53) | Only after explicit scope sign-off; authoritative data only | Written scope approval exists |

---

## Phase 5 — Production

| # | Task | Deliverable | Acceptance |
|---|------|-------------|------------|
| 5.1 | Rate limiting across isolates | Replace per-process limiter with Workers rate-limiting binding or a Durable Object; per-user caps on posts/likes/comments | Limits hold across isolates under load |
| 5.2 | Caching review | Verify edge SWR on Workers; KV L2; Hyperdrive query cache; invalidation on writes | Feed p95 under target; stale window ≤ TTL |
| 5.3 | Observability | Structured logs, metrics, traces, alerts; SLOs for read latency and error rate | Synthetic error alerts within minutes |
| 5.4 | E2E + load | Playwright (web), Maestro (mobile), load tests on feed + like endpoints | Green in CI; targets documented |
| 5.5 | CSP nonces | Remove `'unsafe-inline'` scripts (inline scripts moved to files or nonced) | CSP has no `unsafe-inline` for scripts |
| 5.6 | Deploy (#54) | Staging + production Workers via Terraform; custom domain; gradual deployments + rollback runbook; health checks | One-command rollback tested |
| 5.7 | Security pass (#16, final) | Red/blue review including auth, PII, payments | Findings fixed or accepted in writing |
| 5.8 | Launch docs + compliance | README, API reference, CHANGELOG v1.0.0; COMPLIANCE sign-off (privacy policy, ToS, USPTO clearance) | New-dev onboarding from docs alone |

---

## Architecture checklist coverage

| Checklist group | Where |
|---|---|
| Traffic & networking | 1.3 (timeouts, retries, backoff, circuit breakers), 5.1 (rate limiting), 1.2 (one gateway router) |
| Messaging | 4.4 (notifications), 4.6 (scheduled jobs), dead-letter handling in 4.6 |
| Database & storage | 1.5, 2.3 (atomic counters), 2.5 (indexed cursor pagination), 2.8 (KV → Postgres) |
| Concurrency & reliability | 2.3, 2.8 (race tests), SQL advisory locks in `packages/db` |
| Scaling | Workers + edge cache (existing), 5.2 |
| Deployment | 1.2 (multi-host), 5.6 (gradual deploys, rollback, health checks) |
| Observability | 5.3 |
| Security | 2.1, 5.1, 5.5, 5.7, COMPLIANCE.md |
| Data & operations | 1.5 (migrations), 1.6 (Terraform), backups via Neon (5.6 runbook) |
| Performance | existing bench + 5.2, 5.4 |

---

## Open decisions

| # | Decision | Recommendation |
|---|----------|----------------|
| 1 | **Identity model** for ideas/likes/comments. Today bill comments ask for name + district + email (unverified); #46 plans gov-ID verification | Accounts with verified email + public handle. Gov-ID verification later (4.8) adds a "verified constituent" badge rather than gating posting |
| 2 | **Reactions on people's ideas.** Bills already use agree/disagree/neutral | Likes only on people's ideas (as originally described); keep the three-way reactions on bills |
| 3 | **Auth implementation** | An open-source auth library running inside our API against our Postgres, not a hosted auth service (decoupling rule 2). Confirm library in 2.1 |
| 4 | **Self-likes** | Allowed |
| 5 | **Web framework for new screens** | Expo Router with web output, so new screens are written once for mobile and web; existing static pages migrate later. Alternative: Next.js (your usual web stack) |
| 6 | **Officials data** | Seed from Congress.gov + OpenStates (already integrated) instead of manual entry |
| 7 | **Overlap threshold k** | 10, pairwise only |
| 8 | **Repo visibility** | Currently public; your default is private. Your call |

Resolved: geocoder = U.S. Census (already used by `/api/reps`); database host = Neon; mobile = Expo
(replaces Swift + Kotlin); backend stays TypeScript (exception to the FastAPI default, kept reversible
by the OpenAPI contract).

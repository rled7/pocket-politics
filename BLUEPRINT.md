# Pocket Politics — Build Blueprint

The locked plan we execute against. Detail lives in `PROJECT_TRACKER.md`; this is the
execution contract so we build continuously without re-deciding every step.

## Working agreement
- **Full autonomy.** Build whole phases; only stop for things that genuinely need the
  user: API keys, deploy/DNS, money/legal. Review at phase boundaries.
- One shared backend API (Cloudflare Pages Functions); web first, then iOS (Swift) + Android.

## Product = two pillars
- **KNOW** — transparency: who governs you, record, votes, money, contact.
- **ACT** — the "How To": participate, run, get hired, build.

## App shell — 5 destinations (bottom tabs / top nav)
1. **Home / My Government** — your reps at every level, next election, alerts, take-action.
2. **Explore** — directory (members) + bills + money; search-driven.
3. **Elections** — your races, candidates, sample ballot, compare.
4. **Act** — the How-To civic-action hub.
5. **Saved** — follows, alerts, settings.

Rep profile = tabs: Overview · Record · Votes · Money · Contact · Schedule.

## Tech (v1)
- Web client: a polished **client-side SPA** in `web/` (hash router, zero-build, deploys
  as static on Cloudflare Pages alongside `/functions`). Migrate to React only if needed.
- Design: civic/editorial — parchment + navy + brass, **Public Sans** (the US gov design
  system font) + a serif for headlines. Trustworthy, document-like, data-dense, readable.

## Scale & data aggregation (the core requirement: 1M+ concurrent)
**Goal:** millions can access the data without a problem. **Principle:** aggregate the
data into our own edge store; never hit a government API on a user's request.

- **Serve from the edge.** Static app shell on Cloudflare's global CDN (unlimited
  concurrency). API on serverless Workers (auto-scaling). Our infra is not the bottleneck.
- **Ingest, don't proxy.** Scheduled jobs (Cloudflare **Cron Triggers**) pull
  Congress.gov / OpenStates / etc. on a timer and write **normalized** data into our store.
  Gov APIs only ever see our handful of ingest calls — well within their rate limits.
- **Store at the edge:** **KV** for hot reads (members, bills, profiles — globally
  replicated, massive read throughput), **D1** (SQLite) for relational/search, **R2** for
  bulk JSON snapshots, pre-generated static JSON on the CDN for the hottest lists.
- **Cache hard.** `Cache-Control` on every API response so the CDN absorbs the vast
  majority of reads before a Function even runs.
- **Read path:** Function → KV (single-digit ms) → *(miss)* live API + populate KV →
  *(no key)* fixture. The `src/store.ts` wrapper is **graceful**: if KV isn't bound it
  no-ops and we fall back, so adding KV is purely additive and never breaks serving.
- **Provisioning (needs the Cloudflare account):** `wrangler kv namespace create
  POCKETPOL_KV`, bind it, set `CONGRESS_API_KEY` + `REFRESH_TOKEN`, add a Cron Trigger
  hitting `/api/refresh`. Load-testing to 1M is a later milestone; the architecture supports it.

## Phase order (continuous build)
- **A** — App shell + federal depth (members/bills/profile wired, search, address→reps,
  My-Government home) + **deploy**.
- **B** — Elections + Money (FEC/OpenSecrets, races by address, candidate compare).
- **C** — How-To hub (evergreen guides + official links → personalize by address).
- **D** — State (OpenStates) + City (Legistar).
- **E** — AI bill summaries (cheap model + cache; cite source, never fabricate).
- **F** — Native apps (SwiftUI iOS + Compose Android) on the same API.
- **G** — Accounts, alerts, weekly digest.
- **H** — 3-sided marketplace + monetization.

Started 2026-06-10. This turn: app shell + Explore (members/bills) + profile + Act(How-To) wired.

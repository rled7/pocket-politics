# TRACKER.md — Pocket Politics build log

One entry per build (BUILD number = `BUILD` in the backend's `build.ts`, shown at `/api/version`
and in the page footer). Each entry: date, PHASES task, files, summary, test status.
Detailed release notes live in `CHANGELOG.md`.

---

## BUILD-001 – BUILD-095 — Pre-plan history (2026-06 → 2026-06-20)

Federal/state/local civic data app, civic guides, bill comments + reactions, caching engine,
TypeScript-vs-Rust bake-off. See `CHANGELOG.md` and `DONE.md`. Ended at 123/123 tests passing.

## BUILD-096 — Plan of record + affiliation schema

- **Date:** 2026-10-25
- **Phase/Task:** planning (precedes 1.1)
- **Files:** `PHASES.md`, `TRACKER.md`, `EDGE_CASES.md`, `COMPLIANCE.md` (new);
  `packages/db/` (schema, SQL tests, queries, SCHEMA.md; new);
  `CHANGELOG.md`, `README.md`, `REMAINING.md`, `src/build.ts` (updated)
- **Summary:** Adopted the monorepo + one-router + Neon plan. Imported the identity &
  affiliation schema designed 2026-10-08 (communities supertype, geo-derived districts with
  versioned boundaries, org hierarchy, officials/terms, privacy controls). Recorded a
  67-request parity baseline of build 95 for the 1.1/1.2 refactors. Found during review: 18 API
  routes missing on the Cloudflare path and a comment-argument bug there (fixed by task 1.2).
- **Tests:** 123/123 TypeScript; 20/20 SQL (PostgreSQL 16 + PostGIS, run locally, CI in 1.5).

## BUILD-097 — Monorepo layout

- **Date:** 2026-10-25
- **Phase/Task:** 1.1 (Monorepo layout)
- **Files:** moved with `git mv` — `src/` + `fixtures/` → `apps/api/`; `web/` → `apps/web/`;
  `rust/` → `apps/api-rust/`; `bench/` → `tools/bench/`; root `package.json` + `tsconfig.json` →
  `apps/api/`. New: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `pnpm-lock.yaml`,
  `apps/web/package.json`, `tools/bench/package.json`. Removed: `package-lock.json`.
  Path fixes: `functions/**` imports, `apps/api/src/{api_server,serve,demo}.ts`,
  `apps/api-rust/src/main.rs` (`include_str!`), `tools/bench/{conformance.ts,run_all.sh}`,
  `.gitignore`, `wrangler.toml`, `.github/workflows/ci.yml`. Docs: `README.md`, `DEPLOY.md`,
  `API_CONTRACT.md`, `CACHING_ARCHITECTURE.md`, `PERSISTENT_SERVER_DEPLOYMENT.md`,
  `tools/bench/README.md`, `CHANGELOG.md`, `TRACKER.md`; `apps/api/src/build.ts` (0.55.0 / 97).
- **Summary:** Restructured into the target Turborepo + pnpm layout from `PHASES.md` with no behavior
  change. `functions/` stays at the root for Cloudflare Pages. Dependency versions carried over
  exactly from the old `package-lock.json`; `turbo` 2.11.10 added. CI now uses pnpm + turbo.
- **Tests:** 123/123 TypeScript; typecheck clean; Rust release build OK, conformance 4/4; 67-request
  parity capture identical to the build-95 golden.

## BUILD-098 — One router on Cloudflare Workers

- **Date:** 2026-10-25
- **Phase/Task:** 1.2 (One router on Cloudflare Workers)
- **Files:** new — `apps/api/src/{app,worker,node,edge_cache,views,security_headers}.ts`,
  `app.test.ts`, `edge_cache.test.ts`, `apps/api/tsconfig.worker.json`,
  `apps/web/{_headers,_redirects,.assetsignore}`. Removed — `functions/` (all 8 handlers),
  `apps/api/src/api_server.ts` (→ `node.ts`, `git mv`), the committed `.wrangler/` state.
  Rewritten — `wrangler.toml` (Pages → Workers + Static Assets), `DEPLOY.md`, `apps/api/src/config.ts`
  (`loadConfig`). Updated — `payments.ts`, `translate.ts` (injected config); `budget`, `calendar`,
  `cloture`, `record`, `lobbying`, `nystate`, `openstates` (fixtures as JSON modules); `geo`, `money`,
  `nystate` (type-only `json()` casts for Workers types); `http.test.ts` (new signatures);
  `apps/api/package.json` (`hono`, `wrangler`, `@cloudflare/workers-types`, scripts), root `package.json`
  (`worker:dev`, `worker:deploy`, `wrangler`), `pnpm-lock.yaml`, `.gitignore`, `.github/workflows/ci.yml`
  (Workers dry-run), `tools/bench/{run_all.sh,README.md}`, `README.md`, `SECURITY.md`, `API_CONTRACT.md`,
  `PROJECT_TRACKER.md`, `CACHING_ARCHITECTURE.md`, `PERSISTENT_SERVER_DEPLOYMENT.md`, `EDGE_CASES.md`
  (5 Platform-migration items ticked), `CHANGELOG.md`, `TRACKER.md`, `apps/api/src/build.ts`
  (0.56.0 / 98). **`PHASES.md`:** task 1.2 row updated — edge response caching via the Cache API added
  to the deliverable; parity on Node *and* `wrangler dev` plus a cache-layer test added to the acceptance.
- **Summary:** Every route (the Node server's ~30 plus `/healthz`) is now one Hono app built by
  `createApp({ config, store, rateLimit, clientIp })`; `node.ts` and `worker.ts` are thin hosts. Fixes
  the 18 routes missing on Cloudflare and the comment-argument bug (it was a different handler). Workers
  get edge caching through the Cache API, static security headers via `_headers`, and `/` → `home.html`
  via a `_redirects` rewrite. `hono` 4.13.13, `wrangler` 4.149.0, `@cloudflare/workers-types`
  5.20261010.1 (all exact, ≥ 2 weeks old).
- **Tests:** 294/294 TypeScript (123 existing + 117 route tests + 54 cache/instrumentation); typecheck
  clean on both configs; 67-request parity capture identical to the build-95 golden on Node and under
  `wrangler dev` (only static `Cache-Control` and `text/css; charset=utf-8` differ — Workers asset
  defaults); `wrangler deploy --dry-run` bundles (205 KiB, 49 KiB gzip); Rust conformance 4/4.
- **Review (main session):** re-ran install, typecheck and all 294 tests; Node parity identical on
  67/67; `wrangler dev` parity differs only in Cloudflare's static-asset `Cache-Control` and CSS
  charset; confirmed edge cache MISS → HIT, `/api/reps` BYPASS, and comment posting on Workers.
  Accepted deviations: extra path segments (`/api/members/foo`) now 404 instead of matching
  `/api/members`; Node 500s carry `X-Cache: BYPASS`; failed background refreshes are logged;
  `.wrangler/` state untracked (a 1.1 follow-up). Follow-ups filed: cache-key normalization,
  `SwrCache` bound, POST size cap and query-free error logs → task 1.3; proxy-only
  `X-Forwarded-For` trust → 5.1; dotfiles on Node and KV write-error handling → EDGE_CASES.md.

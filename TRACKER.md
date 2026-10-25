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

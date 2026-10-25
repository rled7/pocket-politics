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

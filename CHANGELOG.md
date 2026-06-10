# Changelog

All notable changes to Pocket Politics. Format follows [Keep a Changelog](https://keepachangelog.com);
this project uses date-stamped milestones while pre-1.0.

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

[0.3.0]: https://github.com/rled7/pocket-politics
[0.2.0]: https://github.com/rled7/pocket-politics
[0.1.0]: https://github.com/rled7/pocket-politics

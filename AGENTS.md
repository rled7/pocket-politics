# AGENTS.md

## Cursor Cloud specific instructions

Pocket Politics is a civic-transparency app: a **TypeScript backend + static web frontend**
(the production stack) plus a **Rust backend** that exists only as a "bake-off" reference
implementation of the core API contract. Toolchain (Node 22, npm, cargo) is preinstalled;
the startup update script runs `npm install`.

### Services & how to run them

- **Full app (TS API + web UI), the main dev target** — `npm run api` serves both the JSON
  API and the static `web/` frontend on `http://localhost:8788`. The root path lands on the
  directory; `/explore.html` is the searchable member directory; clicking a member opens the
  profile page. This is what you usually want for end-to-end work.
- **Web viewer only (static, no API)** — `npm run serve` → `http://localhost:5174`. Needs
  `npm run demo` first to generate `web/profile.json` + `web/members.json` from fixtures.
- **Rust reference backend** — `cd rust && cargo build --release` then
  `PORT=8787 ./rust/target/release/pp-server`. Implements only the core contract
  (`/api/members`, `/api/bills`, `/api/profile`, `/api/latest`). Not needed for normal
  feature work; only used by the bake-off.

### Lint / test / build / typecheck

- Typecheck (the closest thing to a lint; there is no ESLint): `npm run typecheck`.
- Tests: `npm test` (a single tsx runner, `src/http.test.ts`; ~117 assertions).
- Rust build: `cd rust && cargo build --release`.
- Bake-off conformance gate (Rust must match the TS reference JSON): start the Rust server,
  then `BASE=http://localhost:8787 npx tsx bench/conformance.ts`. Full bench is
  `npm run bench` (builds Rust, boots both servers, conformance + load test).

### Non-obvious gotchas

- **No API key is required to run anything.** Without `CONGRESS_API_KEY` (and the other keys
  in `src/config.ts`) every endpoint serves a clearly-labeled **demo fixture** from
  `fixtures/`, so the directory, search and profile all work offline. Profile pages will read
  "Sample Member (DEMO FIXTURE — not a real record)" — this is expected, not a bug. Set
  `CONGRESS_API_KEY` (free: api.congress.gov/sign-up) for live data; other optional keys
  (FEC, OpenStates, NY OpenLeg, Stripe, Anthropic/OpenAI) unlock their respective features.
- Local secrets are read from a gitignored `.dev.vars` or the process environment (see
  `src/config.ts`); in prod they come from Cloudflare. There is no `.env` loader wired in for
  the standalone server — pass env vars inline (e.g. `CONGRESS_API_KEY=xxx npm run api`).
- The deployed production target is **Cloudflare Pages Functions** (`functions/api/*`);
  `src/api_server.ts` is the same shared data layer wrapped in `node:http` for local dev and
  for the benchmark. Use `npm run api` locally rather than wrangler.

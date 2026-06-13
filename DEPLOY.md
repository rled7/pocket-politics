# Deploy — Pocket Politics

Two paths: **Cloudflare Pages** (the default; serverless, scales free) or the
**persistent server** (see [`PERSISTENT_SERVER_DEPLOYMENT.md`](./PERSISTENT_SERVER_DEPLOYMENT.md)).
This file covers Cloudflare Pages. Steps marked 🔑 need your Cloudflare account.

## 1. First deploy (gets you live in minutes)
1. 🔑 Push this repo to GitHub (already at `github.com/rled7/pocket-politics`).
2. 🔑 Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings: **Build command:** *(none)* · **Output directory:** `web`. Functions in
   `functions/` are auto-discovered. Deploy.
4. 🔑 Add the API key (the app works on fixtures without it, live with it):
   ```bash
   npx wrangler pages secret put CONGRESS_API_KEY      # paste your Congress.gov key
   ```
   …or dashboard → the Pages project → Settings → Environment variables.
5. Visit the `*.pages.dev` URL. You're live (directory, profiles, bills).

## 2. Turn on the caching engine (the "no lag" part)
1. 🔑 Create the KV namespace and bind it (powers L2 + view-driven optimizer):
   ```bash
   npx wrangler kv namespace create POCKETPOL_KV
   ```
   Paste the returned `id` into `wrangler.toml` (or bind `POCKETPOL_KV` in the dashboard).
   *Graceful: until bound, the app still serves — KV is purely additive.*
2. 🔑 Dashboard → **Caching → Tiered Cache: On**, and **Cache Reserve: On** (persistent edge).
3. **Verify L1 SWR actually engages** (the one thing flagged unverified in
   `CACHING_ARCHITECTURE.md` §3) — after deploy:
   ```bash
   curl -sI https://<your-site>/api/members        # run twice, a few min apart
   # look for cf-cache-status: HIT  then  UPDATING (SWR working). MISS/DYNAMIC = lean on
   # the L0/immutable path (already built) instead.
   ```

## 3. Schedule ingest (pre-generate L0 snapshots)
Pages Functions don't run cron; use a small **scheduled Worker** (or any cron host) to run the
ingest on a timer and write KV + the static snapshots:
- Quick start: run it manually / from CI: `CONGRESS_API_KEY=… npm run ingest` (writes `dist/`).
- Production: a Worker with a `[triggers] crons = ["0 */6 * * *"]` calling the same logic, or
  a GitHub Action on a schedule. (Tracked as a follow-up; the read path works without it —
  endpoints fall back to live + fixtures.)

## 4. Custom domain
🔑 Pages project → **Custom domains** → add yours. Same backend serves the web app today and
the iOS/Android clients later.

## Rollback
Cloudflare Pages keeps every deployment — roll back from the dashboard's Deployments tab.

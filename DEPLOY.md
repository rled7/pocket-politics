# Deploy — Pocket Politics

Two paths: **Cloudflare Workers** (the default; serverless, scales free) or the
**persistent server** (see [`PERSISTENT_SERVER_DEPLOYMENT.md`](./PERSISTENT_SERVER_DEPLOYMENT.md)).
This file covers Workers. Steps marked 🔑 need your Cloudflare account.

One codebase, two hosts: the whole API is one Hono app (`apps/api/src/app.ts`). `worker.ts` runs it
on Workers; `node.ts` runs the same app in a container. The static client in `apps/web/` is served
by Workers Static Assets. (Cloudflare recommends Workers over Pages for new projects; Pages
Functions are gone — `functions/` was deleted in build 98.)

## 0. Try it locally (no account needed)
```bash
pnpm install
pnpm worker:dev                      # http://localhost:8787 — pages + API on fixtures, simulated KV
pnpm worker:deploy --dry-run --outdir /tmp/pp-bundle     # bundles the Worker; uploads nothing
```
Local secrets for `worker:dev` go in a gitignored `.dev.vars` file next to `wrangler.toml`
(`CONGRESS_API_KEY=…`). The Node server (`pnpm api`) reads the same names from its environment.

## 1. First deploy (gets you live in minutes)
1. 🔑 Push this repo to GitHub (already at `github.com/rled7/pocket-politics`).
2. 🔑 Log in to Cloudflare from the repo root:
   ```bash
   pnpm wrangler login
   ```
3. 🔑 Create the KV namespace (comments, reactions, trending, view counts live here) and paste the
   returned `id` over `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in `wrangler.toml`:
   ```bash
   pnpm wrangler kv namespace create POCKETPOL_KV
   ```
   *Graceful: with KV unbound the app still serves, on a per-isolate in-memory store (comments
   won't persist). To deploy before creating KV, comment out the `[[kv_namespaces]]` block —
   a placeholder id makes `wrangler deploy` fail.*
4. 🔑 Deploy:
   ```bash
   pnpm worker:deploy                 # prints https://pocket-politics.<your-subdomain>.workers.dev
   ```
5. 🔑 Add the API keys as secrets (the app works on fixtures without them, live with them):
   ```bash
   pnpm wrangler secret put CONGRESS_API_KEY      # paste your Congress.gov key
   ```
   Other names `loadConfig` understands (`apps/api/src/config.ts`): `FEC_API_KEY`, `LDA_API_KEY`,
   `NY_OPENLEG_API_KEY`, `OPENSTATES_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
   (+ `OPENAI_BASE_URL`, `TRANSLATE_MODEL`), `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PLUS`,
   `STRIPE_PRICE_PRO`, `STRIPE_PRICE_UNLIMITED`. …or dashboard → the Worker → Settings →
   Variables and Secrets.
6. Visit the `*.workers.dev` URL. You're live (directory, profiles, bills, every other route).

## 2. Deploy on every push (connect the GitHub repo)
So a push to GitHub deploys without running a command:
1. 🔑 Dashboard → **Workers & Pages** → create/import from **Git** (Workers Builds), or for the
   Worker you just deployed: **Settings → Build → Connect** → pick the repo and the production branch.
2. Keep the Worker name equal to `name = "pocket-politics"` in `wrangler.toml`.
3. **Root directory:** `/` · **Build command:** *(none)* · **Deploy command:** `pnpm run worker:deploy`
   (not the default `npx wrangler deploy`, so the build uses the wrangler version pinned in
   `pnpm-lock.yaml`). Other branches get preview builds.
4. Secrets and the KV binding live on the Worker, so they carry over between builds.

## 3. Edge caching — verify it after deploy
`apps/api/src/edge_cache.ts` stores successful, public `GET /api/*` responses in the Cache API, so the
government APIs behind the app are hit only on a cache **miss** (never for `POST`, `/api/comments`,
`/api/reactions`, `/api/reps`, or errors). Every API response carries `X-Cache: HIT | MISS | BYPASS`.

Cloudflare documents Cache API operations for Workers on **custom domains**, and the cache is **per
data center** (a route is refetched at most once per city per `s-maxage`). It ignores
`stale-while-revalidate`, so expired entries refetch on the next request. Check what your hostname does
(use `GET`; a `HEAD` request is never cached):
```bash
curl -s -D - -o /dev/null https://<your-site>/api/members | grep -i x-cache    # MISS
curl -s -D - -o /dev/null https://<your-site>/api/members | grep -i x-cache    # HIT = working
```
If it stays `MISS` on `*.workers.dev`, the Cache API isn't active there — attach a custom domain
(§5) and check again before relying on it. (Edge SWR, KV as an L2 and Tiered Cache are task 5.2.)

## 4. Schedule ingest (pre-generate L0 snapshots)
The request Worker has no cron trigger yet. Run the ingest on a timer from CI or a cron host:
- Quick start: run it manually / from CI: `CONGRESS_API_KEY=… pnpm ingest` (writes `apps/api/dist/`).
- Production: a Worker cron trigger (`[triggers] crons = ["0 */6 * * *"]`) calling the same logic, or
  a GitHub Action on a schedule. (Tracked as a follow-up; the read path works without it —
  endpoints fall back to live + fixtures.)

## 5. Custom domain
🔑 Dashboard → the Worker → **Settings → Domains & Routes → Add → Custom domain** (the domain's DNS
must be on Cloudflare). Same backend serves the web app today and the iOS/Android clients later.

## Static pages on Workers
Static files are served by Workers Static Assets **without running the Worker**, so two things that
the Node server does in code are done by config files in `apps/web/`:
- `_headers` — the same security headers (CSP, HSTS, …) as the API; a test fails if it drifts from
  `apps/api/src/security_headers.ts`.
- `_redirects` — `/  /home.html  200`, a **rewrite** (the URL stays `/`), like the Node server's landing.
- `.assetsignore` keeps `package.json` out of the published files.

## Rollback
Workers keeps every version — dashboard → the Worker → **Deployments** → roll back, or
`pnpm wrangler rollback`.

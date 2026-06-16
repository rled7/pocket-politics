# Security posture & audit — Pocket Politics

A blue-team audit of the **currently shipped** surface (build 76), plus a red-team threat list and the
mitigations to add as the gated features (accounts, payments, identity verification) come online. The
full red/blue pass (#16) runs after the feature set locks; this documents where things stand now.

## Architecture (attack-surface relevant)
- **Server**: a single Node `http` server (`src/api_server.ts`) that serves the static `web/` client and
  the `/api/*` endpoints. No database — state lives in a KV/JSON `Store` (`src/store.ts`).
- **Secrets**: all API keys read server-side from a gitignored `.dev.vars` (local) / Cloudflare secrets
  (prod) via `src/config.ts`. **Keys are never sent to the client** — every third-party call is made
  server-side. `/api/integrations` returns booleans only (configured or not), never values.

## Endpoint inventory
- **Read, cached (GET)**: members, bills, profile, votes, bill, money, reps, calendar, budget, cloture,
  record, state, ny/*, lobbying, trending, pricing, version, integrations, latest. All go through the
  SWR cache; no side effects.
- **Write / sensitive (POST), rate-limited**: `/api/comments`, `/api/reactions`, `/api/checkout`,
  `/api/translate` (paid AI), `/api/track`.

## Mitigations IN PLACE ✅
- **Secret hygiene** — keys server-side only; gitignored; booleans-only status endpoint.
- **Output encoding (XSS)** — every interpolation of user/API data in the client runs through `esc()`.
- **Security headers** — CSP (locks `object-src`/`base-uri`/`frame-ancestors`, restricts script/style/
  img/connect origins), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy`, `Permissions-Policy` (geolocation self-only; camera/mic off). *Caveat:* the app is
  inline-script-heavy, so CSP allows `'unsafe-inline'` for scripts — `esc()` remains the primary XSS
  defense; migrating inline scripts to files + nonces is a future hardening.
- **Input validation** — bill-id and bioguide regexes; `state` validated against a 50-name allowlist
  (blocks upstream-URL/SSRF injection); limits clamped; free-text capped (translate input, comment text).
- **SSRF** — all outbound calls use fixed base URLs with encoded/allowlisted params.
- **Rate limiting** (`src/ratelimit.ts`) — per-IP on every POST; strictest on the **paid** `/api/translate`
  (10/min) so the AI endpoint can't be spammed to run up tokens; 429 + `Retry-After`.
- **Cost controls** — translator uses a cheap model, hard `max_tokens` + input caps, per-bill cache, and
  usage logging (a paid endpoint without these is a financial-DoS risk).
- **PII minimization** — comment email is stored privately and never returned in the public list.
- **Content moderation** (`src/moderation.ts`) — rules-based block of links/promo/phone/all-caps/nonsense.
- **Path traversal** — static serving normalizes the path and confirms it stays within `web/`.
- **Injection** — no SQL (KV/JSON store) → no SQLi; no shelling out on user input.
- **Supply chain** — minimal deps (tsx + native `fetch`, no vendor SDKs) → small surface.

## Red-team threat list & TODO (mostly gated on the unbuilt features)
- **No auth yet** — there are no user sessions/cookies, so there's no cross-site request state to forge
  today. **When accounts (#15) land:** add CSRF protection on state-changing POSTs, secure/HttpOnly/
  SameSite cookies (or token auth), and per-account authorization checks.
- **Payments (#38)** — using Stripe **hosted** Checkout keeps card data off our server (minimal PCI
  scope). **TODO:** verify webhook signatures with `STRIPE_WEBHOOK_SECRET` before trusting fulfillment
  events; never trust client-sent prices (we don't — Price IDs are server-mapped).
- **Identity verification / voter data (#46/#15)** — the highest-sensitivity data (gov IDs, voter
  status). **TODO before launch:** encrypt at rest, strict retention minimization, access logging, legal
  review of state voter-file usage, and a privacy policy. Treat this as its own dedicated review.
- **AI endpoint (#7/#31/#32/#44)** — rate-limited today; **TODO** when accounts exist: per-account spend
  quotas. Prompt-injection risk is low (bill text → summary output, no tool/actions), but keep outputs
  display-only and never execute model output.
- **DoS** — rate limiting is in-process (fine for one server). **TODO** in prod: rely on Cloudflare's
  edge limits + a shared store for multi-replica limiting.

## Recommendation
Run the **full red/blue pass + an OSS scanner** (e.g., the community Claude security-agent repos) once
accounts, payments, and identity verification are implemented — that's when the high-value attack surface
(auth, money, PII) actually exists. Until then, the above mitigations cover the current read-mostly app.

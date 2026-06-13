# Pocket Politics — Persistent-Server Deployment (provider-portable, "in case we leave Cloudflare")

> Companion to `CACHING_ARCHITECTURE.md`. That doc assumes Cloudflare primitives (Pages
> Functions, KV, D1, R2). This doc lays out the **persistent-server** path so we are **never
> locked in** — the same TS and Rust backends run on any container host, with the *identical*
> caching behavior, by swapping a few infrastructure pieces for portable equivalents.
>
> **Headline principle: don't marry the provider.** Exactly three things tie an app to a host
> — *compute*, *hot store*, and *CDN*. Each has a portable equivalent. Code to an interface,
> not to Cloudflare, and "switching" becomes a config change, not a rewrite.

---

## 1. What changes vs Cloudflare (the swap table)

| Concern | Cloudflare way | Portable persistent-server way |
|---|---|---|
| **Compute** | Pages Functions (ephemeral isolates) | **One long-lived process** in a Docker container (Node or Rust) |
| **In-memory cache (L-1)** | ❌ doesn't exist (isolates die) | ✅ **per-process LRU** (the unlock) |
| **Hot store (L2)** | KV (global) | **Redis / Valkey** (or Postgres) |
| **Relational/search (L3)** | D1 (SQLite) | **Postgres** |
| **Bulk objects (L0/R2)** | R2 | **S3-compatible object storage** (Bunny, Backblaze B2, MinIO) |
| **CDN edge cache (L1)** | Cloudflare CDN | **any CDN** — standard HTTP headers work everywhere |
| **TLS / routing** | automatic | **Caddy or nginx** reverse proxy (Caddy = auto-TLS) |
| **Scheduled ingest (L4)** | Cron Trigger | **cron on the host** or a separate worker process |

**Why the caching design survives the move untouched:** every cache directive in
`CACHING_ARCHITECTURE.md` — `Cache-Control`, `stale-while-revalidate`, `stale-if-error`,
`ETag`/`304`, `immutable`, the version-pointer scheme — is **standard HTTP**. It is honored by
Fastly, Bunny, CloudFront, nginx, Varnish — anyone. The architecture was portable by design;
only the *storage and compute substrate* changes here.

---

## 2. The process model (this is the actual "server")

A single long-lived process that boots once and stays up:

- **TypeScript:** Node + **Fastify** (or Hono on the Node adapter). In-memory L-1 = `lru-cache`.
- **Rust:** **axum** (or actix-web). In-memory L-1 = `moka` (async LRU) or `lru`.
- Both: a `/healthz` endpoint, graceful shutdown on SIGTERM (drain in-flight, then exit),
  structured JSON logs, and the **same `API_CONTRACT.md` responses** (so they stay swappable).

**This is your "backend runs only once" made literal:** the expensive ingest work happens on a
timer in a separate path; the serving process just answers from its caches.

```
            ┌─────────── one container ───────────┐
 request ─▶ │  axum / Fastify server              │
            │   ├─ L-1  in-memory LRU (nanoseconds)│  ← only exists because the process persists
            │   ├─ L2   Redis/Valkey (shared)      │
            │   └─ L3   Postgres + object storage  │
            └──────────────────────────────────────┘
                         ▲
            L4 ingest job (cron) writes L2/L3 + regenerates L0 static, stamps dataVersion
```

---

## 3. THE scaling gotcha (the one thing people get wrong — teaching note)

The moment you run **more than one instance** (for traffic or redundancy), the in-memory pantry
becomes a **problem**: instance A's cache is not instance B's. Two consequences:

1. **Hit-rate dilution** — each instance warms its own memory separately.
2. **Invalidation gets hard** — purging "member O000172" must reach *every* instance, not one.

**The fix is a two-level cache ("near + far"):** per-process LRU (L-1, fast) *in front of* a
**shared** Redis/Valkey (L2, consistent across instances). Read path: check local memory → miss
→ check Redis → miss → compute + populate both.

And here's where the design pays off: **the version-pointer scheme (CACHING §4) makes this
nearly free.** Because data lives at **immutable** keys (`…/v/{dataVersion}/profile/X.json`),
instances **never need to invalidate** each other — a new `dataVersion` just means new keys, and
old ones age out. All instances only have to agree on the current pointer, which is one tiny
value in Redis. Multi-instance scaling stops being scary.

---

## 4. Where it runs (host options, ranked by portability ÷ ops-pain)

All of these take a **Docker container** — which you already know how to produce (this is
literally the AlgoForge `Dockerfile.cpp-lang` pattern). Containerize once, run anywhere:

| Host | Best for | Ops pain | Notes |
|---|---|---|---|
| **Fly.io** | global low-latency | low | runs your container near users in many regions; closest thing to "edge" for a persistent server |
| **Railway / Render** | simplest DX | lowest | push repo → it builds + runs the container; managed Redis/Postgres add-ons |
| **Hetzner / any VPS + Docker** | cheapest, full control | medium | ~$5–15/mo box; you run Caddy + the container + Redis; most control |
| **Kubernetes (any cloud)** | max portability/scale | high | overkill until real scale; the *most* provider-agnostic |

**Portability win:** because it's a plain container, moving Fly → Hetzner → AWS is "run the same
image somewhere else." No platform rewrite.

---

## 5. The front (keep edge caching even off Cloudflare)

Two honest paths:

- **Keep Cloudflare as JUST a CDN** in front of your container origin. You can use Cloudflare's
  CDN + DDoS shield + edge cache **without** using Cloudflare for compute. You keep L0/L1 edge
  caching and lose nothing on the read path; only your *origin* moved. Lowest-friction "switch."
- **Fully leave:** put **Bunny CDN** or **Fastly** in front, terminate TLS at **Caddy** (auto
  HTTPS) or nginx on your host. Same standard cache headers → same behavior.

Either way the **L0 static layer** (precomputed JSON) lives in object storage (S3/B2/Bunny) and
is fronted by the CDN — that's still your nanosecond hot path, provider-independent.

---

## 6. The portability abstraction (the one engineering move that makes all this cheap)

Define a thin **`Store` interface** the app codes against; provide two implementations:

```
interface Store {
  get(key): bytes | null
  put(key, bytes, ttl?)
  // + a tiny pointer get/set for dataVersion
}
```

- `CloudflareStore`  → KV / D1 / R2
- `SelfHostedStore`  → Redis / Postgres / S3

The serving code and the ingest job **never name a provider** — they use `Store`. Switching
hosts = pick a different implementation at startup (env var). The project already has the seed
of this: the **graceful `store.ts` wrapper** that no-ops when KV isn't bound. We formalize it
into this interface, and **both the TS and Rust backends implement the same two stores** — which
*also* keeps the bake-off fair (same abstraction, different language).

---

## 7. Ingestion off Cloudflare (the "runs once" job)

- A scheduled job (host cron, or a `node`/`rust` binary triggered by a timer/systemd timer):
  fetch upstream → normalize → LLM-summarize once → write Redis/Postgres → **regenerate L0
  static** and upload to object storage → bump `dataVersion`.
- Runs in **its own container/process**, never on the serving hot path. If it crashes, serving
  keeps answering from the last good caches (this is `stale-if-error` at the data layer).

---

## 8. What you take on by going persistent (named honestly)

| | Serverless (Cloudflare) | Persistent server |
|---|---|---|
| Idle cost | ~$0 | a small always-on box + Redis (~**$10–30/mo** realistic) |
| Scaling | automatic | **your job** (add instances + the L-1/L2 two-level cache, §3) |
| In-memory tier | none | ✅ yours |
| Ops (TLS, health, deploy, backups, metrics) | provider handles | **you handle** (Caddy + a deploy pipeline + Postgres backups) |
| Lock-in | higher | low (containers + standard headers + `Store` interface) |
| Honest language bake-off | flattened by sandbox | ✅ true native comparison |

**Bottom line:** the persistent path costs you some ops and a few dollars a month, and buys you
the in-memory tier, a *real* TS-vs-Rust comparison, and freedom to leave any host. The caching
*architecture* doesn't change — only the substrate under it. Build to the `Store` interface from
day one and the choice stays reversible.

---

### Minimal "leave Cloudflare" checklist (when/if the day comes)
1. Stand up Redis + Postgres + object storage (managed add-ons or a VPS).
2. Point the app at `SelfHostedStore` (env var); deploy the container to Fly/Hetzner/etc.
3. Put a CDN in front (keep Cloudflare-CDN-only, or Bunny/Fastly); Caddy for TLS if self-hosting.
4. Move the ingest job to host cron; verify it regenerates L0 static into object storage.
5. Re-run `bench/run_all.sh` against the new origin to confirm the latency budget (§0 of the
   caching doc) still holds.

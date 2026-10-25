# EDGE_CASES.md — Pocket Politics

Registry of known edge cases. Each gets a test before its phase exits.
Status: ☐ open · ☐→ test written · ☑ covered

## Data integrity

- ☐ **Double-like race** — same user toggles like concurrently; composite PK +
  upsert-in-transaction must yield consistent end state and correct count.
- ☐ **Count drift** — `like_count` / `comment_count` drift from actual rows;
  nightly reconciliation job, alert on drift > 0.
- ☐ **Deleted user** — soft delete; ideas/comments persist with
  "[deleted user]" display; likes retained in counts.
- ☐ **Edit after traction** — idea edited after gaining likes could bait-and-
  switch what people endorsed; lock editing at 25 likes, show "edited" flag
  below that.
- ☐ **Tombstoned comment with replies** — parent removed, replies preserved;
  thread renders tombstone, not orphaned replies.

## Ranking & feeds

- ☐ **Cursor stability under Hot churn** — hot_score shifts while user
  scrolls; cursor on `(hot_score, id)` snapshot semantics, no dupes/skips.
- ☐ **Like/unlike churn** — rapid toggling must not inflate hot_score
  (recompute from count, never increment score directly).
- ☐ **Top-window boundary** — idea posted 23h59m ago in "day" window;
  define window as rolling, document it.
- ☐ **Zero-state feeds** — brand-new deployment / filtered tag with no
  ideas; empty states, no crashes.

## Merge & duplicates

- ☐ **Merged-idea like union** — user liked both A and B before merge;
  counts once after B → A merge.
- ☐ **Merge redirect loops** — B → A then A → B must be rejected; chain
  merges (C → B → A) resolve to terminal target.
- ☐ **Search after merge** — search/similar-ideas returns the merge target,
  never the merged-away record.

## Trust & safety (political UGC specifics)

- ☐ **Report brigading** — N reports must never auto-remove; queue priority
  may rise, removal is always a moderator action with audit row.
- ☐ **Reporter anonymity** — reported user can never see who reported them,
  including via timing or API side-channels.
- ☐ **Moderator self-action** — moderator cannot action reports on their own
  content.
- ☐ **Spam patterns** — new account posting N near-identical ideas; rate
  limits + similarity check at post time as first line.

## Input handling

- ☐ **Unicode/emoji/RTL** in titles and comments — render and count
  correctly; length limits in characters, not bytes.
- ☐ **Pathological titles** — 1-char titles, whitespace-only, zero-width
  characters; trim + minimum-length validation.
- ☐ **Links in posts** — the existing comment moderation rejects any URL.
  Decide in task 2.2 whether ideas follow the same rule; no link previews or
  safety scanning in MVP.

## Platform migration (tasks 1.1–1.2)

- ☑ **Two hosts, one app** — Workers has no filesystem and no `process.env`;
  fixtures must be bundled modules and config injected, or routes fail only
  in production (this is how 18 endpoints went missing on Cloudflare).
- ☑ **Memory cache is Node-only** — the SWR memory cache, prewarm and refresh
  loop exist only on the Node entry; Workers relies on edge cache + KV.
  Responses must be identical either way; only latency differs.
- ☐ **Per-isolate rate limits** — the in-memory limiter resets per Workers
  isolate, so limits are weaker on Workers until task 5.1.
- ☑ **Static pages without the Worker** — Workers serves static assets
  without running app code, so security headers and the `/` → home landing
  need explicit handling there.
- ☐ **KV free-plan write cap** — 1,000 writes/day on the free plan; today every
  profile view, trending ping, comment and reaction writes to KV. Writes over the
  cap fail with an error. Fixed by task 2.8; until then, KV write failures must
  never fail the request.
- ☑ **KV unbound** — `wrangler.toml` still has a placeholder KV id; the app
  must keep working on the in-memory store when KV isn't bound.
- ☑ **Old comment payloads** — clients that send `{bill, author, text}` without
  district/email get a clear 400, not a 500.

- ☐ **Node serves dotfiles meant for Cloudflare** — `apps/web/_headers`, `_redirects`
  and `.assetsignore` are reachable on the Node server (no secrets in them). Skip them
  in Node's static handler when it's next touched.
- ☐ **KV write errors leak through** — a failed KV write on comments returns 400 with the
  KV error text; on reactions/track it returns 500. Covered by task 2.8 (writes move to
  Postgres).

## Affiliations & geography (build 96; T# = packages/db/tests/affiliations_test.sql)

- ☑ **Point on a district line** — one district per type, lowest code wins
  (T3). Still flag these residences for manual review.
- ☑ **Moving within a district** — membership row and start date preserved,
  no end/restart churn (T18, deferred trigger).
- ☑ **Redistricting** — district identity kept, members reassigned,
  ideas stay attached (T19).
- ☑ **Self-declared district** — rejected; districts only from address (T8).
- ☑ **Two primary residences** — rejected (T11).
- ☑ **Union hierarchy cycle** — rejected (T6). ☐ Concurrent re-parenting
  is serialized by an advisory lock but not yet load-tested.
- ☑ **Seat conflicts** — overlapping terms for one seat rejected (T5).
  ☐ Vacancies and special elections: close term early, gap is allowed.
- ☑ **Bad imported geometry** — invalid polygons and overlapping boundary
  versions rejected (T12, T13). ☐ Same-type overlap between different
  districts is checked by the import script (task 1.7), not the schema.
- ☐ **Address outside loaded districts** (outside NYC) — user gets only the
  levels that cover them; UI must handle partial coverage.
- ☐ **Geocoder miss** (new construction, PO box, typo) — never fall back to
  postcode centroid (can cross district lines); ask the user to correct.
- ☐ **No address shared** — app works with orgs + public board only.
- ☐ **Abolished district** — no current boundary, members ended; community
  becomes read-only archive.
- ☐ **Moved-away author** — their ideas stay on the old district board; they
  lose posting rights there.
- ☐ **Overlap differencing** — comparing A∩B with A∩B∩C can reveal a
  suppressed group. Keep overlap pairwise only, rate-limit, consider rounding.
- ☐ **Union membership exposure** — private by default, never listed
  publicly without opt-in, officers can't see private members (task 4.5).
- ☐ **Spoofed membership** — `self_declared` vs `org_verified` must render
  differently; only officers of a verified org can verify.

## Mobile UI (Phase 3 polish checklist)

- ☐ Keyboard never covers the comment composer (notched + non-notched).
- ☐ Safe-area correct on feed, detail, and post flow.
- ☐ Optimistic like rollback is visually clean (no count flicker loops).
- ☐ Pull-to-refresh during in-flight pagination doesn't duplicate rows.
- ☐ AMOLED theme audit: no pure-white flashes on navigation transitions.

## Deferred (decided, not built)

- Geo-verified jurisdiction feeds (location verification design needed).
- Anonymous posting (rejected for MVP — abuse magnet without verification).
- Downvotes (revisit post-launch with engagement data).
- Link previews / URL safety scanning.

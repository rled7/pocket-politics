# Pocket Politics — done log (compact)

The terse index of what's shipped. **Full detail lives in `CHANGELOG.md`** (read on demand — not meant to
be loaded every time). Keeping *this* file to one line per item is the whole point: small = cheap in space
and tokens. (See the note at the bottom on how this stays small.)

## Federal data (live)
- ✓ Members directory + profiles (record, contact, salary, web presence)
- ✓ Bills feed + bill detail (sponsor, "who introduced & why", full cosponsor roster)
- ✓ Campaign finance on profiles (FEC, live)
- ✓ Lobbying on profiles — who's paying to lobby on their issues (Senate LDA, live)
- ✓ Voting record link-outs (GovTrack/Congress.gov) + functional votes tab
- ✓ Congressional calendar — visual month grid + click-day agenda + auto-linked bills
- ✓ Bill-lifecycle tracker — "where this bill is" (introduced → law)
- ✓ Budget & shutdown watch — appropriations bills + passed-this-year + status table
- ✓ Filibuster & cloture — what got filibustered + who voted to sustain it
- ✓ Congressional Record (daily federal floor record)

## State & local
- ✓ All 50 states — legislators + bills (OpenStates, live)
- ✓ New York deep — bills, laws, daily transcripts, floor calendars, committee agendas
- ✓ Find every official — federal → state → county → city → judges/ALJs (finder routing)
- ✓ My City — location-aware local dashboard

## Civic literacy
- ✓ How a bill becomes law (+ amendments) · ✓ Plain-language glossary (plain + legalese)
- ✓ Constitutions (US + 50 states) · ✓ How law & courts work (viz)
- ✓ Laws/regulations/ordinances finder · ✓ Presidents · ✓ Supreme Court · ✓ Every office (titles)

## Take action / help
- ✓ Take Action (vote/run/hire/organize) + Start-a-business · ✓ Get help (assistance/HRA hub)
- ✓ Vote / GOTV finder · ✓ Election integrity (secure-vote + report + verified audits)
- ✓ Defend yourself in civil court · ✓ Civic events (filterable)

## Platform / UX
- ✓ Sub-ms SWR cache + prewarm · ✓ Facebook-style HUD layout · ✓ Visual site map
- ✓ Smart remembered home · ✓ Reactions feed (👍/👎/😐) · ✓ Comments w/ identity gate
- ✓ "Ideas" mode (judge the idea, then reveal who) · ✓ Trending surface
- ✓ Build numbers + CHANGELOG + footer badge

## Scaffolded (activate with a key)
- ✓ Bill translator (legalese→plain English + dual key-points) — needs ANTHROPIC_API_KEY
- ✓ Stripe payments + 3-sided pricing page — needs Stripe key + Price IDs
- ✓ API integration registry + secrets-safe status

## Security
- ✓ CSP + security headers · ✓ input allowlists (SSRF) · ✓ per-IP rate limiting (incl. paid AI endpoint)
- ✓ comment moderation (spam/promo) · ✓ SECURITY.md audit

---
**How this stays small (your question):** three tiers, so the always-loaded part is tiny —
1. **This `DONE.md`** = one line per item (the index). Small.
2. **`CHANGELOG.md`** = the detailed chapters. On disk; opened only when you need the detail.
3. **`~/.claude/.../MEMORY.md`** = one line per *project* (cross-project index).
Tokens are only spent when a file is actually read — so a terse index + detail-on-demand keeps day-to-day
cost near zero while losing nothing.

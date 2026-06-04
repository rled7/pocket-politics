# Pocket Politics — Map to Completion
*Living plan · v0.1 · 2026-06-04 · tied to the user's "how to start something" program*

> A civic-transparency platform that gives **registered voters** a verified
> past/present/future picture of their politicians at **federal, state, and city**
> levels — who's voting how, who's lobbying for what and for how much — and
> connects **nonprofits** with voters by location. Politicians pay to maintain a
> verified profile; voters are free (ad-supported, $0.99 to remove ads).
> Web + iOS + Android. No hard deadline — build incrementally toward a demo.

---

## 1. The three sides (it's a marketplace)
| Side | Gets | Pays |
|------|------|------|
| **Voters** | Verified reps, full voting history (every bill + date), lobbying money trails, upcoming votes/meetings, ballot info | Free (ads) · **$0.99** to remove ads |
| **Politicians** | A **verified** profile they vouch for; reach to constituents; PR channel to publish their schedule/positions | **$1,500/mo** |
| **Nonprofits** | Connection to registered voters by location/issue; advocacy reach | Pricing TBD (likely tiered subscription) |

> Marketplace reality: this is a **3-sided chicken-and-egg**. Voters come for data;
> politicians/nonprofits pay for the audience; but the audience needs the data
> *before* anyone pays. **Resolution: the data must stand alone first** (built from
> public sources), so voters show up *before* a single politician pays. The $1,500
> fee is an *enhancement* (verification + PR channel), never the source of truth.

## 2. Data architecture — THE crux (honest reality check)
The vision says "directly from the White House / state / city." Here's what that
actually means, easiest → hardest:

| Level | Reality | Real sources (mostly free, official) |
|-------|---------|--------------------------------------|
| **Federal legislative** | ✅ Very doable | **Congress.gov API** (official: bills, votes, members, voting history), GovTrack, `@unitedstates` project |
| **Federal executive** ("White House") | 🟡 Partial | **Federal Register API** (exec orders, rules), WH press feeds. No single "WH API" — aggregate. |
| **Lobbying / money** | 🟡 Doable (federal) | **Senate LDA API** (lobbying disclosures), **OpenSecrets API** (who funds whom). State lobbying = patchwork. |
| **State legislative** | ✅ Doable | **OpenStates / Plural API** (bills, legislators, votes, all 50 states) |
| **City / local** | 🔴 Hardest (you're right) | **Legistar/Granicus API** (powers many city councils), per-city scrapers, manual. No universal standard. |

**Key reframing:** you don't "get data from the White House" — you **aggregate
authoritative public feeds** and present them better than anyone. The $1,500
politician + PR-team loop *augments and verifies* that base, it doesn't replace it.

## 3. The verification & update loop (the PR-team model)
Vision: email politicians' PR teams → they return info → we verify → publish →
update daily. Honest notes:
- ✅ Great for **future** data (schedules, planned meetings, positions) that no API has.
- ⚠️ **Integrity risk:** if a politician pays $1,500 and "verifies" their own record,
  the platform can look pay-to-spin. **Mitigation:** votes/lobbying come from
  *independent official sources* and are immutable; the politician can only annotate,
  never edit, the public record. Show a clear "verified by office" vs "public record" badge.
- ⚠️ Legal/PII: connecting nonprofits to voters "with actual addresses" touches
  **voter-file law (varies by state)** and privacy regs. Must be designed with counsel;
  likely start with voters *opting in* to be reachable, not raw address matching.

## 4. Tech architecture (web + iOS + Android — "all fronts")
- **One backend API** (the source of truth) + **ingestion workers** per data source.
  Suggested: a Node/TS or Python API; Postgres; scheduled ingestion jobs (daily).
  Reuses your existing stack (React/TS + Cloudflare).
- **Clients share that API:** Web (React/Vite) first; mobile via **React Native**
  (or Flutter) so iOS+Android share one codebase. Don't build 3 native apps.
- **AI use (cost-aware):** summarizing bills/positions into plain English is the
  natural LLM use. Cache aggressively, summarize once per bill (not per request),
  log per-feature cost. (Ties to your always-on cost-optimizer practice.)

## 5. Phased map to completion (incremental — add detail as you go)
- **Phase 0 — Demo slice (do first):** ONE level, ONE place. Pick a state or
  Congress; pull real bills + one politician's full voting history from
  Congress.gov/OpenStates; show a clean profile: past votes (with dates), current
  bills, plain-English summaries. Web only. *This is the "make something happen" demo.*
- **Phase 1 — Federal MVP:** all of Congress — member profiles, full voting
  histories, bill tracking, plain-English summaries. Web.
- **Phase 2 — Money trail:** layer in lobbying/funding (Senate LDA + OpenSecrets)
  onto profiles and bills — "who's pushing this, how much, how far along."
- **Phase 3 — State:** add OpenStates (start with the user's home state).
- **Phase 4 — Voter features:** address → "your reps"; issue-following; nonprofit
  connection (opt-in, legally reviewed). Ads + $0.99 remove-ads.
- **Phase 5 — Mobile:** React Native iOS + Android off the same API.
- **Phase 6 — Politician onboarding:** verified profiles, PR-team update pipeline,
  $1,500/mo billing, "verified vs public record" badges.
- **Phase 7 — City/local:** Legistar API + per-city ingestion (hardest, do last/iterative).
- **Phase 8 — Nonprofit marketplace + scale.**

## 6. Hard problems / risks (name them early)
1. **City-level data** has no standard — solve per-city, last.
2. **Legal/PII** around voter addresses & nonprofit matching — needs counsel; design opt-in.
3. **3-sided chicken-egg** — solve by making the public-data product valuable *alone* first.
4. **Data accuracy & trust** — independent official sources for the record; politicians annotate only.
5. **Cost at scale** — daily ingestion + LLM summaries; cache + summarize-once.
6. **Scope** — this is large; Phase 0→1 is the credible near-term; everything else is the long game.

## 7. Immediate next step
Build **Phase 0**: scaffold the web app + pull one real politician's voting history
from a free official API (Congress.gov or OpenStates) into a clean profile view.
That's a tangible demo for the program and proves the data pipeline is real.

## Open decisions (for next session)
- Which Phase-0 target: U.S. Congress (Congress.gov) or your home state (OpenStates)?
- Backend language: Node/TS (matches your web stack) vs Python (richer civic-data libs)?
- Confirm app name / branding ("Pocket Politics").

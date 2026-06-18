# Pocket Politics — data coverage & API map

What we cover today (and with which key), what's missing, and exactly what to sign up for to fill the
gaps. "Checked off in correlation to what we have."

## ✅ Have now — FREE, wired (keys already in `.dev.vars`)
| Level | Data | Source (key) |
|---|---|---|
| **Federal** | all 535 members, bills + full timeline, votes, summaries, cosponsors | Congress.gov ✓ |
| **Federal** | campaign finance (raised/spent/cash) | FEC ✓ |
| **Federal** | lobbying disclosures | Senate LDA ✓ |
| **Federal** | cloture/roll-call votes incl. per-senator detail | senate.gov (no key) ✓ |
| **State** | **all 50** state legislatures — legislators + bills | OpenStates ✓ |
| **State (NY)** | deep: bills + votes, laws, transcripts (full text), calendars, agendas | NY Open Legislation ✓ |
| **Local (city)** | **1,798 municipalities** — mayors / councils | OpenStates *municipal* ✓ (just wired) |

### OpenStates municipal coverage (the free local data we have)
- **1,798 cities** across **~44 states** (verified live). Heaviest: **AR (~150!), CA, TX, IL, NJ, FL, MI,
  GA, PA, OH, CO, NC, WA, NY, IA**. (~2/3 of all U.S. municipalities are *not* in this set — see gaps.)
- Use it: the "Find every official → look up your city" tool. Cities not covered fall back to finders.

## 🟡 Gaps — what to sign up for
| Want | Best source | Cost | Notes |
|---|---|---|---|
| **Where to vote / polling places** (GOTV #52) | **Google Civic Information API** | **FREE** (key) | ⚠️ Google **shut down the *representatives* part** (~2025) — it now only returns **elections + polling places**, which is still useful for GOTV. Sign up: console.cloud.google.com → enable "Civic Information API". |
| **Every local official** (the ~2/3 of cities + counties OpenStates misses) | **Cicero API (Azavea)** | **PAID** (per-lookup / subscription) | The real answer for comprehensive city/county/township officials by address. cicerodata.com |
| **Even deeper (school boards, some ALJs, ballot data)** | **Ballotpedia API** | **PAID / enterprise** | Largest editorial dataset; API is gated. |
| **AI features** (translator, summaries) | **Anthropic** or **OpenRouter** | pay-as-you-go | translator is provider-agnostic — any key works. |
| **Payments** | **Stripe** | per-transaction | scaffolded; needs secret + Price IDs. |

## 🔴 No clean API anywhere (finder/scrape only)
- **Administrative law judges** (parking/traffic/benefits tribunals) — not in any national dataset, even
  Cicero/Ballotpedia are spotty. Genuinely per-jurisdiction (e.g., NYC OATH, state OAH). Finder links only.
- Most **small towns / villages** and **special districts** outside OpenStates' 1,798.

## Bottom line
- **No new key needed** for: federal, all 50 states, 1,798 cities, NY-deep, finance, lobbying, votes.
- **One FREE signup** worth doing: **Google Civic** key → live polling-place lookup for GOTV.
- **To truly hit "every local official down to ALJs":** that needs **Cicero (paid)** for the local breadth,
  and ALJs remain finder-only. There is no free path to 100% local — OpenStates' 1,798 + finders is the
  free maximum, and it's a lot.

# API Sources — where every level's data comes from

The single reference for **which API + where to get the key**, by government level. All are
free/official unless noted. Keys go in env vars (never committed) — see `DEPLOY.md`.

## Federal (built / wiring)
| Data | API | Get the key | Status |
|---|---|---|---|
| Members, bills, **votes**, sponsored record | **Congress.gov** `api.congress.gov` | https://api.congress.gov/sign-up/ (free) | ✅ wired (`CONGRESS_API_KEY`) |
| **Campaign finance** (raised/spent/cash) | **FEC** `api.open.fec.gov` | https://api.data.gov/signup/ (free) | ✅ wired (`FEC_API_KEY`) |
| **Lobbying** (who lobbies, on what, $) | **Senate LDA** `lda.senate.gov/api/` | register at lda.senate.gov (free) | ⬜ next money layer |
| Funding aggregates (who funds whom) | **OpenSecrets** `opensecrets.org/api` | opensecrets.org/api/admin/index.php (free) | ⬜ optional |
| Member socials + cross-IDs (incl. FEC id) | **@unitedstates/congress-legislators** | none (public GitHub/Pages JSON) | ✅ wired (socials + money mapping) |
| Per-member roll-call detail (House) | Congress.gov `house-vote` JSON | (Congress.gov key) | ✅ wired |
| Per-member roll-call detail (Senate) | **Senate LIS** XML `senate.gov/legislative/LIS/roll_call_lists` | none | ⬜ (votes show House only today) |
| Executive (orders, rules) | **Federal Register** `federalregister.gov/developers/api/v1` | none (free, no key) | ⬜ future |
| Public comment on federal rules | **Regulations.gov** `api.regulations.gov` | https://api.data.gov/signup/ | ⬜ future |

## State (next — task #8)
| Data | API | Get the key |
|---|---|---|
| Bills, legislators, votes, committees — **all 50 states** | **OpenStates / Plural** `v3.openstates.org` | https://open.pluralpolicy.com/accounts/signup/ (free key) |
| Statewide offices / ballot measures | OpenStates + per-state SoS sites | varies by state |

## City / local (hardest — task #8)
| Data | API | Notes |
|---|---|---|
| City council agendas/members/votes | **Legistar (Granicus)** `webapi.legistar.com/v1/{client}` | many city councils; mostly open, per-client (no universal key) |
| Municipal open data | **Socrata** portals (`data.cityof*.gov`) | per-city; app token optional |
| County (clerk, sheriff, DA) | county sites / scrapers | no standard — solve per-county |

## Civic action / "How To" (task #7)
| Need | Source |
|---|---|
| Register / check registration / polling place | **vote.gov** + each state's election office |
| Government jobs | **USAJOBS API** `developer.usajobs.gov` (free key) |
| Comment on federal rules | **regulations.gov** |
| Run for office / campaign committee | **FEC** (federal) + state election offices |

## Plain-language law help (linked from the app)
- **OpenCase** — https://www.opencase.com/ — free-tier AI that explains U.S. law (trained on
  Cornell LII's database). Linked on the bill page so readers can get a bill in plain English.

> Pattern for every new source: add a typed client (like `src/congress.ts`/`money.ts`), a
> fixture for the no-key path, a handler, an endpoint, and an env var — never hit the source on
> a user request (ingest → cache → serve; see `CACHING_ARCHITECTURE.md`).

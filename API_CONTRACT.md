# Pocket Politics — Frozen API Contract (v1)

> **The keystone of the multi-language bake-off.** Every backend implementation
> (TypeScript, Go, Python, Rust — whichever we build) MUST return byte-compatible
> JSON for these endpoints. The shared web frontend points at any conforming backend
> via a base-URL switch, so we can plug implementations in and out with zero frontend
> change — and benchmark them apples-to-apples on identical inputs.
>
> Extracted 2026-06-13 from the existing TypeScript reference (`functions/api/*.ts`,
> `src/profile.ts`, `src/congress.ts`) and the demo fixtures. **This file is the source
> of truth; the TS code is reference implementation #1, not the spec.**

## Conventions (all endpoints)

- **Method:** `GET` only (v1 is read-only).
- **Content-Type:** `application/json`.
- **Cache-Control:** `public, max-age=300` on success (public record changes slowly;
  lets the CDN absorb the vast majority of reads — see BLUEPRINT "Cache hard").
- **Envelope flags:** every success response carries `"live": boolean`. When the backend
  has no upstream API key it serves the bundled demo fixture with `"live": false` and a
  human `"note"`. With a key + successful upstream fetch, `"live": true` and no `note`.
- **Determinism for the bake-off:** with **no key set**, every implementation MUST return
  the *fixture* payloads below verbatim (modulo `generatedAt` timestamps). This is what
  makes the cross-language benchmark fair — identical bytes, identical work.

## Errors

| Condition | HTTP | Body |
|---|---|---|
| Malformed input (e.g. bad bioguide id) | `400` | `{ "error": "<message>" }` |
| Upstream (Congress.gov) failure | `502` | `{ "error": "<message>", "live": false }` |

---

## `GET /api/profile`

One member's normalized profile (identity + salary + contact + sponsored/record).

**Query params**

| Param | Type | Default | Rule |
|---|---|---|---|
| `bioguide` | string | `O000172` | Upper-cased; MUST match `^[A-Z]\d{6}$` or → `400`. |

**Success body** (`Profile` + envelope)

```json
{
  "bioguideId": "S000XXX",
  "name": "Sample Member (DEMO FIXTURE — not a real record)",
  "party": "Independent",
  "state": "New York",
  "chamber": "House of Representatives",
  "salary": { "amount": 174000, "role": "Rank-and-file member" },
  "contact": {},
  "record": [
    {
      "id": "HR 1042 (118th)",
      "title": "Municipal Transparency in Lobbying Act",
      "date": "2024-02-14",
      "policyArea": "Government Operations",
      "latestAction": "2024-03-01: Referred to the Committee on Oversight.",
      "role": "sponsored"
    }
  ],
  "generatedAt": "2026-06-10T02:23:41.952Z",
  "sources": [
    "Congress.gov API (api.congress.gov) — public record",
    "Congressional salary: public record (CRS / 2 U.S.C. §4501)"
  ],
  "live": false,
  "note": "Demo data — set CONGRESS_API_KEY for the live record."
}
```

**Field rules**
- `record[].id` = `"{TYPE} {NUMBER} ({CONGRESS}th)"` (e.g. `HR 1042 (118th)`).
- `record[].latestAction` = `"{actionDate}: {text}"` flattened from upstream.
- `record[].policyArea` = upstream `policyArea.name` (string; `""` if absent).
- `record[].role` = `"sponsored"` in v1 (cosponsored/votes added later).
- `salary.amount` = integer USD from the public schedule; `salary.role` = the role label.

---

## `GET /api/members`

The full "everyone in Congress" directory.

**Query params**

| Param | Type | Default | Rule |
|---|---|---|---|
| `limit` | int | `250` | Clamped to `[1, 250]`. |

**Success body**

```json
{
  "members": [
    { "bioguideId": "O000172", "name": "Ocasio-Cortez, Alexandria", "party": "Democratic", "state": "NY", "district": 14, "chamber": "House of Representatives" },
    { "bioguideId": "S000033", "name": "Sanders, Bernard", "party": "Independent", "state": "VT", "chamber": "Senate" }
  ],
  "count": 4,
  "live": false,
  "note": "Demo data — set CONGRESS_API_KEY for all 535 members."
}
```

- `district` present only for House members (omit for Senate).
- `count` = `members.length`.

---

## `GET /api/bills`

Bills currently moving through Congress, most recent first.

**Query params**

| Param | Type | Default | Rule |
|---|---|---|---|
| `limit` | int | `20` | Clamped to `[1, 50]`. |

**Success body**

```json
{
  "bills": [
    {
      "congress": 118,
      "type": "HR",
      "number": "1",
      "title": "Lower Energy Costs Act",
      "originChamber": "House",
      "latestAction": { "actionDate": "2023-03-30", "text": "Passed/agreed to in House." },
      "updateDate": "2023-03-30"
    }
  ],
  "count": 3,
  "live": false,
  "note": "Demo data — set CONGRESS_API_KEY for live bills."
}
```

- `count` = `bills.length`.

---

## Conformance & bake-off harness (planned)

`bench/run_all.sh` (AlgoForge pattern) will, for each backend:
1. boot it on a clean port in an identical container (no key → fixture mode),
2. fire the same request set at `/api/profile`, `/api/members`, `/api/bills`,
3. assert each response is byte-equal to the frozen fixtures (conformance gate),
4. record p50/p95 latency + throughput under identical load.

A backend that fails conformance is disqualified before its numbers count — so the
comparison only ever ranks *correct* implementations. Production deploy of the winner:
Cloudflare Pages if TS/Rust, container host if Go/Python (see the language-deploy map
in the project docs).

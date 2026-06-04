# Pocket Politics — Phase 0

Verified politician profiles from **public** government data — *aggregated and
presented in one place* (the product is the aggregation, not the data). This
Phase-0 slice proves the pipeline: pull a member of Congress's dated legislative
record from the official **Congress.gov API** and render a clean profile.

See [`ROADMAP.md`](./ROADMAP.md) for the full map to completion (3-sided
marketplace, federal→state→city, lobbying money trail, monetization).

## Run it

```bash
npm install

# Offline — builds a profile from fixtures/ (no key, no network):
npm run demo

# View it:
npm run serve      # → http://localhost:5174
```

## Go live (real data)

1. Get a free API key: https://api.congress.gov/sign-up/
2. Run with the key (and optionally a specific member's bioguideId):

```bash
export CONGRESS_API_KEY=your_key_here
BIOGUIDE=O000172 npm run demo:live   # then `npm run serve`
```

Find a `bioguideId` at https://www.congress.gov (it's in each member's URL).

## What Phase 0 shows
- **Past view:** dated sponsored-legislation record from Congress.gov (real, public).
- Present (live bill status) and Future (upcoming votes / schedule) tabs are
  stubbed — those are later phases (see ROADMAP).

## Layout
```
src/congress.ts   Congress.gov API client (member + sponsored legislation)
src/profile.ts    normalize → Profile (the "past" record, newest-first)
src/demo.ts       fixture (default) or live runner → writes web/profile.json
src/serve.ts      minimal static server for the viewer
web/index.html    profile viewer (past/present/future tabs)
fixtures/         offline sample data (clearly marked — not a real record)
```

## Notes
- Data is openly available; **aggregation + verification + personalization
  (incl. city level + future schedule) is the differentiator.**
- Roll-call vote *positions* (vs. sponsored bills) come from the House Clerk /
  Senate LIS / GovTrack — a Phase-1 enrichment on top of this base.

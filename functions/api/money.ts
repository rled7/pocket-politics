/// <reference types="@cloudflare/workers-types" />

// GET /api/money?bioguide=O000172 — campaign finance (FEC). Maps bioguide → FEC candidate id
// via the @unitedstates dataset, then FEC totals. Demo fixture when FEC_API_KEY isn't set.
import { getMoney } from '../../src/money.ts';
import { jsonCached, jsonError } from '../../src/http.ts';
import { isBioguide, DEFAULT_BIOGUIDE } from '../../src/handlers.ts';

export const onRequestGet: PagesFunction<{ FEC_API_KEY?: string }> = async (context) => {
  const { request, env } = context;
  const b = (new URL(request.url).searchParams.get('bioguide') || DEFAULT_BIOGUIDE).toUpperCase();
  if (!isBioguide(b)) return jsonError('Invalid bioguide id (expected e.g. O000172)', 400);
  try {
    return jsonCached(await getMoney(b, env.FEC_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'FEC error', 502, { live: false });
  }
};

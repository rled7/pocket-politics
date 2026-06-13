/// <reference types="@cloudflare/workers-types" />

// GET /api/votes?congress=118&type=hr&number=1 — who voted on a bill (per-member roll calls).
// House positions via Congress.gov's house-vote JSON; Senate per-member positions need LIS XML
// (listed, members empty for now). Logic in src/handlers.ts.
import { getBillVotes } from '../../src/handlers.ts';
import { jsonCached, jsonError } from '../../src/http.ts';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const { request, env } = context;
  const q = new URL(request.url).searchParams;
  const congress = parseInt(q.get('congress') ?? '118', 10) || 118;
  try {
    return jsonCached(await getBillVotes(congress, q.get('type') ?? 'hr', q.get('number') ?? '1', env.CONGRESS_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Congress.gov error', 502, { live: false });
  }
};

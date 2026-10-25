/// <reference types="@cloudflare/workers-types" />

// GET /api/bills — bills currently moving through Congress, most recent first.
import { getBills, clampLimit } from '../../apps/api/src/handlers.ts';
import { jsonCached, jsonError } from '../../apps/api/src/http.ts';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const { request, env } = context;
  const limit = clampLimit(new URL(request.url).searchParams.get('limit'), 20, 50);
  try {
    return jsonCached(await getBills(limit, env.CONGRESS_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Congress.gov error', 502, { live: false });
  }
};

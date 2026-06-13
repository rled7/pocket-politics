/// <reference types="@cloudflare/workers-types" />

// GET /api/v/{version}/members — IMMUTABLE, version-addressed directory (cache for a year).
import { getMembers, clampLimit } from '../../../../src/handlers.ts';
import { jsonImmutable, jsonError } from '../../../../src/http.ts';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const { request, env } = context;
  const limit = clampLimit(new URL(request.url).searchParams.get('limit'), 540, 540);
  try {
    return jsonImmutable(await getMembers(limit, env.CONGRESS_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Congress.gov error', 502, { live: false });
  }
};

/// <reference types="@cloudflare/workers-types" />

// GET /api/reps?address=... — your representatives (Census geocode → district → members).
import { getReps } from '../../src/handlers.ts';
import { jsonCached, jsonError } from '../../src/http.ts';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const { request, env } = context;
  const addr = (new URL(request.url).searchParams.get('address') ?? '').trim();
  if (!addr) return jsonError('address required', 400);
  try {
    return jsonCached(await getReps(addr, env.CONGRESS_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'lookup error', 502);
  }
};

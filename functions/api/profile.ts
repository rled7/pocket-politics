/// <reference types="@cloudflare/workers-types" />

// Shared backend for Pocket Politics — ONE API the web + (future) native clients consume.
// The Congress.gov key stays server-side. Data logic lives in src/handlers.ts so the mutable
// route here and the immutable versioned route (api/v/[version]/profile) share one source.
import { getProfile, DEFAULT_BIOGUIDE, isBioguide } from '../../src/handlers.ts';
import { jsonCached, jsonError } from '../../src/http.ts';
import { getStore, type KVLike } from '../../src/store.ts';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string; POCKETPOL_KV?: KVLike }> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const bioguide = (url.searchParams.get('bioguide') || DEFAULT_BIOGUIDE).toUpperCase();

  if (!isBioguide(bioguide)) {
    return jsonError('Invalid bioguide id (expected e.g. O000172)', 400);
  }
  // Instrument demand in the background (never blocks the response). The ingest optimizer
  // reads these counts so pre-generation becomes demand-driven (graceful: no-op without KV).
  if (env.POCKETPOL_KV) {
    context.waitUntil(getStore(env).incr(`views:${bioguide}`).catch(() => {}));
  }
  try {
    return jsonCached(await getProfile(bioguide, env.CONGRESS_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Congress.gov error', 502, { live: false });
  }
};

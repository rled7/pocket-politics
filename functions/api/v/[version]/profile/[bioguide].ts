/// <reference types="@cloudflare/workers-types" />

// GET /api/v/{version}/profile/{bioguide} — IMMUTABLE, version-addressed profile.
// The {version} pins a data snapshot, so the bytes never change → cache for a year, never
// revalidate (CACHING_ARCHITECTURE.md §4). In fixture mode the data is constant, so any
// version serves the current fixture; once the ingest job lands, {version} selects the
// matching snapshot.
import { getProfile, DEFAULT_BIOGUIDE, isBioguide } from '../../../../../src/handlers.ts';
import { jsonImmutable, jsonError } from '../../../../../src/http.ts';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const { request, params, env } = context;
  const bioguide = String(params.bioguide || DEFAULT_BIOGUIDE).toUpperCase();
  if (!isBioguide(bioguide)) {
    return jsonError('Invalid bioguide id (expected e.g. O000172)', 400);
  }
  try {
    return jsonImmutable(await getProfile(bioguide, env.CONGRESS_API_KEY), { request });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Congress.gov error', 502, { live: false });
  }
};

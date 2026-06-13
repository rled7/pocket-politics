/// <reference types="@cloudflare/workers-types" />

// Shared backend for Pocket Politics — ONE API that the web, iOS (Swift), and
// Android clients all consume. Pulls a member profile from Congress.gov server-side
// so the API key stays a secret (never shipped to any client). Falls back to the
// bundled demo fixture when no key is configured, so the deployed site always works.
import { fetchMember, fetchSponsored } from '../../src/congress.ts';
import { buildProfile } from '../../src/profile.ts';
import type { Profile } from '../../src/profile.ts';
import type { ApiMember, ApiSponsored } from '../../src/congress.ts';
import { jsonCached, jsonError } from '../../src/http.ts';
import memberFixture from '../../fixtures/member.json';
import sponsoredFixture from '../../fixtures/sponsored.json';

const DEFAULT_BIOGUIDE = 'O000172'; // Rep. Alexandria Ocasio-Cortez (NY-14)

function fixtureProfile(): Profile {
  return buildProfile(memberFixture as ApiMember, sponsoredFixture as ApiSponsored[]);
}

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const bioguide = (url.searchParams.get('bioguide') || DEFAULT_BIOGUIDE).toUpperCase();

  // Bioguide ids look like one letter + 6 digits (e.g. O000172) — validate to avoid
  // forwarding junk to Congress.gov.
  if (!/^[A-Z]\d{6}$/.test(bioguide)) {
    return jsonError('Invalid bioguide id (expected e.g. O000172)', 400);
  }

  const key = context.env.CONGRESS_API_KEY;

  // No key → serve the demo fixture so the live site still demonstrates the product.
  if (!key) {
    return jsonCached(
      { ...fixtureProfile(), live: false, note: 'Demo data — set CONGRESS_API_KEY for the live record.' },
      { request },
    );
  }

  try {
    const [member, sponsored] = await Promise.all([fetchMember(bioguide, key), fetchSponsored(bioguide, key)]);
    return jsonCached({ ...buildProfile(member, sponsored), live: true }, { request });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Congress.gov error';
    return jsonError(message, 502, { live: false });
  }
};

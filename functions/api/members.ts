/// <reference types="@cloudflare/workers-types" />

// GET /api/members — the full "everyone in Congress" directory. Server-side
// Congress.gov pull (key stays secret); demo fixture when no key is configured.
import { fetchMembers } from '../../src/congress.ts';
import membersFixture from '../../fixtures/members.json';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const url = new URL(context.request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '250', 10) || 250, 1), 250);
  const key = context.env.CONGRESS_API_KEY;

  if (!key) {
    const members = membersFixture as unknown[];
    return Response.json({ members, count: members.length, live: false, note: 'Demo data — set CONGRESS_API_KEY for all 535 members.' });
  }
  try {
    const members = await fetchMembers(key, limit);
    return Response.json({ members, count: members.length, live: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Congress.gov error', live: false }, { status: 502 });
  }
};

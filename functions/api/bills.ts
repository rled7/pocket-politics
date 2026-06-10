/// <reference types="@cloudflare/workers-types" />

// GET /api/bills — bills currently moving through Congress, most recent first.
// Server-side Congress.gov pull; demo fixture when no key is configured.
import { fetchBills } from '../../src/congress.ts';
import billsFixture from '../../fixtures/bills.json';

export const onRequestGet: PagesFunction<{ CONGRESS_API_KEY?: string }> = async (context) => {
  const url = new URL(context.request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
  const key = context.env.CONGRESS_API_KEY;

  if (!key) {
    const bills = billsFixture as unknown[];
    return Response.json({ bills, count: bills.length, live: false, note: 'Demo data — set CONGRESS_API_KEY for live bills.' });
  }
  try {
    const bills = await fetchBills(key, limit);
    return Response.json({ bills, count: bills.length, live: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Congress.gov error', live: false }, { status: 502 });
  }
};

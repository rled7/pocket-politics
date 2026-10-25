/**
 * Congressional salary — public record, fixed since 2009 (members have declined the
 * automatic COLA every year). Source: Congressional Research Service "Salaries of
 * Members of Congress" + 2 U.S.C. §4501. This is a fixed schedule, not an API.
 */
export interface Pay {
  amount: number; // USD / year
  role: string;
}

const RANK_AND_FILE = 174_000;

// Leadership pay tiers, keyed by substrings that appear in Congress.gov `leadership` titles.
const LEADERSHIP: { match: RegExp; amount: number; role: string }[] = [
  { match: /speaker/i, amount: 223_500, role: 'Speaker of the House' },
  { match: /majority leader|minority leader|president pro tempore/i, amount: 193_400, role: 'Chamber leadership' },
];

export function salaryFor(leadershipTitles: string[] = []): Pay {
  const title = leadershipTitles.join(' ');
  for (const tier of LEADERSHIP) {
    if (tier.match.test(title)) return { amount: tier.amount, role: tier.role };
  }
  return { amount: RANK_AND_FILE, role: 'Rank-and-file member' };
}

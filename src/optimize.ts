/**
 * Cache-admission optimization — WHICH profiles to pre-generate (bake to static L0) to
 * maximize expected cache hits under a fixed budget. Replaces the arbitrary `TOP_N`.
 *
 * The problem (0/1 knapsack):
 *     maximize   Σ valueᵢ · xᵢ        xᵢ ∈ {0,1}   (bake profile i, or don't)
 *     subject to Σ costᵢ  · xᵢ ≤ budget
 *
 * Calculus optimization finds where a smooth curve's slope = 0. This is the DISCRETE
 * version — you can't bake half a profile — so we solve it EXACTLY with dynamic
 * programming. Same payoff: compute the best set directly instead of trial-and-error.
 *
 *   value = expected popularity (real view counts when we have them; a transparent proxy
 *           until then). cost = ingest cost (API calls / payload). With uniform cost this
 *           provably reduces to "top-K by value"; the knapsack handles the general case
 *           where costs differ.
 */

export interface Candidate<T> {
  item: T;
  value: number; // expected payoff (≥ 0)
  cost: number;  // ingest cost (rounded to a positive integer)
}

export interface Selection<T> {
  chosen: T[];
  totalValue: number;
  totalCost: number;
}

/**
 * Exact 0/1 knapsack via dynamic programming. dp[i][w] = best value using the first i
 * items within capacity w; we then backtrack to recover which items were chosen.
 * Pseudo-polynomial: O(n · budget).
 */
export function knapsack<T>(candidates: Candidate<T>[], budget: number): Selection<T> {
  const W = Math.max(0, Math.floor(budget));
  const items = candidates.map((c) => ({ ...c, cost: Math.max(1, Math.round(c.cost)) }));
  const n = items.length;

  // dp[i][w]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { value, cost } = items[i - 1];
    for (let w = 0; w <= W; w++) {
      dp[i][w] = dp[i - 1][w]; // skip item i
      if (cost <= w) dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - cost] + value); // take item i
    }
  }

  // Backtrack to recover the chosen set.
  const chosen: T[] = [];
  let w = W;
  for (let i = n; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      chosen.push(items[i - 1].item);
      w -= items[i - 1].cost;
    }
  }
  chosen.reverse();

  const totalValue = dp[n][W];
  const totalCost = W - w; // capacity consumed
  return { chosen, totalValue, totalCost };
}

/** A member as seen in the directory (the cheap signals available before fetching a profile). */
export interface ScorableMember {
  bioguideId: string;
  chamber?: string;
  party?: string;
  state?: string;
}

/**
 * Value (expected popularity) for a member. Real view counts win when present; otherwise a
 * transparent proxy until we have traffic. The optimizer is correct regardless of the
 * signal's quality — it just gets smarter as the signal does.
 */
export function popularityValue(m: ScorableMember, views?: Record<string, number>): number {
  if (views && views[m.bioguideId] != null) return views[m.bioguideId] + 1; // real demand
  // Proxy until we have logs: 100 senators are individually higher-profile than 435 reps.
  let s = 1;
  if (m.chamber === "Senate") s += 2;
  return s;
}

/**
 * Choose which members to pre-generate profiles for, maximizing expected hits within a
 * budget. `costOf` defaults to uniform 1 (budget == number of profiles); pass a custom cost
 * (e.g. payload size) for the weighted case.
 */
export function selectToPregenerate<T extends ScorableMember>(
  members: T[],
  budget: number,
  opts: { views?: Record<string, number>; costOf?: (m: T) => number } = {},
): Selection<T> {
  const costOf = opts.costOf ?? (() => 1);
  const candidates: Candidate<T>[] = members.map((m) => ({
    item: m,
    value: popularityValue(m, opts.views),
    cost: costOf(m),
  }));
  return knapsack(candidates, budget);
}

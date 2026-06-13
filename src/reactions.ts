/**
 * Bill reactions — "bills as posts": a voter can react 👍 like / 👎 dislike / 😐 neutral, like a
 * social feed. Stored via the graceful `Store` (KV in prod, in-memory locally), exactly like
 * comments.ts. Reactions are low-friction civic signal and live entirely separate from the
 * official record (the public record is never editable by users — see ROADMAP).
 *
 * Identity: reactions are keyed by an anonymous client id (a uuid the browser keeps in
 * localStorage), so one device = one reaction per bill, changeable/retractable. This is
 * deliberately lighter than COMMENTS, which require real attestation (name + district + email).
 */
import type { Store } from "./store.ts";

export type Reaction = "like" | "dislike" | "neutral";
export interface Tally { like: number; dislike: number; neutral: number; }

const REACTIONS: Reaction[] = ["like", "dislike", "neutral"];
export const isReaction = (s: string): s is Reaction => (REACTIONS as string[]).includes(s);
export const validClientId = (s: string) => /^[a-z0-9-]{8,64}$/i.test(s);

const tallyKey = (billId: string) => `rxtally:${billId}`;
const userKey = (billId: string, clientId: string) => `rxuser:${billId}:${clientId}`;
const clamp0 = (n: number) => (n > 0 ? n : 0);

async function readTally(store: Store, billId: string): Promise<Tally> {
  const raw = await store.get(tallyKey(billId));
  if (!raw) return { like: 0, dislike: 0, neutral: 0 };
  try { const t = JSON.parse(raw); return { like: t.like || 0, dislike: t.dislike || 0, neutral: t.neutral || 0 }; }
  catch { return { like: 0, dislike: 0, neutral: 0 }; }
}

/** Current tallies for a bill, plus THIS client's own reaction (so the UI can highlight it). */
export async function getReactions(store: Store, billId: string, clientId?: string): Promise<Tally & { mine: Reaction | null }> {
  const tally = await readTally(store, billId);
  let mine: Reaction | null = null;
  if (clientId && validClientId(clientId)) {
    const m = await store.get(userKey(billId, clientId));
    if (m && isReaction(m)) mine = m;
  }
  return { ...tally, mine };
}

/**
 * Apply a client's reaction with toggle semantics: clicking your current reaction retracts it;
 * clicking a different one moves your vote. Keeps tallies consistent (one vote per client).
 */
export async function setReaction(store: Store, billId: string, clientId: string, reaction: Reaction): Promise<Tally & { mine: Reaction | null }> {
  const tally = await readTally(store, billId);
  const prevRaw = await store.get(userKey(billId, clientId));
  const prev = prevRaw && isReaction(prevRaw) ? prevRaw : null;

  let mine: Reaction | null;
  if (prev === reaction) {
    tally[reaction] = clamp0(tally[reaction] - 1); // toggle off
    await store.put(userKey(billId, clientId), "");
    mine = null;
  } else {
    if (prev) tally[prev] = clamp0(tally[prev] - 1);
    tally[reaction] += 1;
    await store.put(userKey(billId, clientId), reaction);
    mine = reaction;
  }
  await store.put(tallyKey(billId), JSON.stringify(tally));
  return { ...tally, mine };
}

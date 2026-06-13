/**
 * Bill comments — a place for voters to weigh in on a bill. Stored via the graceful `Store`
 * (KV in prod, in-memory locally / on the persistent server). Comments are clearly USER OPINION
 * and live entirely separate from the official record (integrity: the public record is never
 * editable by users — see ROADMAP).
 *
 * ⚠️ Identity: comments are self-attested today. Real *registered-voter* verification is a
 * separate decision (it needs an identity provider / state voter-file matching — a legal +
 * privacy undertaking), tracked as future work. The UI labels comments as unverified.
 */
import type { Store } from "./store.ts";

export interface Comment {
  id: string;
  author: string;
  text: string;
  ts: string;
}

const keyFor = (billId: string) => `comments:${billId}`;
const MAX_KEPT = 1000;

/** Bill id slug, e.g. "118-hr-1". Validated to keep keys/URLs safe. */
export const validBillId = (s: string) => /^[a-z0-9-]{1,40}$/i.test(s);

export async function getComments(store: Store, billId: string): Promise<Comment[]> {
  const raw = await store.get(keyFor(billId));
  if (!raw) return [];
  try { return JSON.parse(raw) as Comment[]; } catch { return []; }
}

export async function addComment(store: Store, billId: string, author: string, text: string): Promise<Comment[]> {
  const a = (author ?? "").toString().slice(0, 60).trim() || "Anonymous";
  const t = (text ?? "").toString().slice(0, 2000).trim();
  if (!t) throw new Error("Comment text is required");
  const list = await getComments(store, billId);
  const comment: Comment = {
    id: Math.random().toString(36).slice(2, 10),
    author: a,
    text: t,
    ts: new Date().toISOString(),
  };
  list.unshift(comment);
  await store.put(keyFor(billId), JSON.stringify(list.slice(0, MAX_KEPT)));
  return list;
}

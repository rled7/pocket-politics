/**
 * Bill comments — a place for voters to weigh in on a bill. Stored via the graceful `Store`
 * (KV in prod, in-memory locally / on the persistent server). Comments are clearly USER OPINION
 * and live entirely separate from the official record (integrity: the public record is never
 * editable by users — see ROADMAP).
 *
 * Identity gate (2026-06-13): you can't comment anonymously. Either you're a signed-in account
 * (future) OR you must attest **name + district number + a valid email**. The email is stored
 * PRIVATELY (never returned in the public list) and starts UNVERIFIED — a comment carries a
 * `verified` flag the UI surfaces. Daily email verification + warning/deactivation for unverified
 * accounts, and content moderation for off-topic/spam comments, are a larger system tracked
 * separately (needs an email provider + accounts).
 */
import type { Store } from "./store.ts";
import { moderate } from "./moderation.ts";

/** Public shape returned to everyone — note: NO email (kept private). */
export interface Comment {
  id: string;
  author: string;
  district: string;
  text: string;
  ts: string;
  verified: boolean; // has the author's email been verified yet?
}
/** Stored shape — adds the private email, never sent to the client list. */
interface StoredComment extends Comment { email: string; }

export interface NewComment { author: string; district: string; email: string; text: string; }

const keyFor = (billId: string) => `comments:${billId}`;
const MAX_KEPT = 1000;

/** Bill id slug, e.g. "118-hr-1". Validated to keep keys/URLs safe. */
export const validBillId = (s: string) => /^[a-z0-9-]{1,40}$/i.test(s);
/** Pragmatic email format check (real verification is a separate emailed-link flow). */
export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const toPublic = ({ email, ...c }: StoredComment): Comment => c;

async function readStored(store: Store, billId: string): Promise<StoredComment[]> {
  const raw = await store.get(keyFor(billId));
  if (!raw) return [];
  try { return JSON.parse(raw) as StoredComment[]; } catch { return []; }
}

export async function getComments(store: Store, billId: string): Promise<Comment[]> {
  return (await readStored(store, billId)).map(toPublic);
}

/**
 * Post a comment — requires name + district + a valid email (no anonymous comments). Throws a
 * user-facing error naming the missing/invalid field. The email is stored privately; the comment
 * is created UNVERIFIED until the address is confirmed.
 */
export async function addComment(store: Store, billId: string, input: NewComment): Promise<Comment[]> {
  const author = (input?.author ?? "").toString().slice(0, 60).trim();
  const district = (input?.district ?? "").toString().slice(0, 12).trim();
  const email = (input?.email ?? "").toString().slice(0, 120).trim();
  const text = (input?.text ?? "").toString().slice(0, 2000).trim();
  if (!author) throw new Error("Your name is required to comment");
  if (!district) throw new Error("Your district number is required to comment");
  if (!validEmail(email)) throw new Error("A valid email address is required to comment");
  if (!text) throw new Error("Comment text is required");
  const mod = moderate(text);
  if (!mod.ok) throw new Error(mod.reason ?? "Comment was held by moderation.");

  const list = await readStored(store, billId);
  const stored: StoredComment = {
    id: Math.random().toString(36).slice(2, 10),
    author, district, email, text,
    ts: new Date().toISOString(),
    verified: false,
  };
  list.unshift(stored);
  const kept = list.slice(0, MAX_KEPT);
  await store.put(keyFor(billId), JSON.stringify(kept));
  return kept.map(toPublic);
}

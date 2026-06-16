/**
 * Comment moderation — a rules-based first line of defense (no AI/key needed) against the exact
 * abuse the user called out: business promotion, links/spam, off-topic shouting, and nonsense.
 * It rejects at post time with a clear, user-facing reason. (A smarter AI/topic-relevance pass can
 * layer on later behind the Anthropic key — see #15/#44 — but this catches the obvious cases free.)
 */
export interface ModerationResult { ok: boolean; reason?: string; }

const URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|biz|shop|store|info|co|app|link)\b)/i;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const PROMO = /\b(buy now|discount|free money|click here|limited time|act now|cash ?app|venmo|crypto|bitcoin|investment opportunity|make money|work from home|promo code|coupon|dm me|subscribe|follow me)\b/i;
const REPEAT = /(.)\1{6,}/; // 7+ of the same character in a row

/** Returns ok:false with a reason when a comment looks like promo / spam / nonsense. */
export function moderate(text: string): ModerationResult {
  const t = (text || "").trim();
  if (t.length < 2) return { ok: false, reason: "Comment is too short." };
  if (URL.test(t)) return { ok: false, reason: "Links aren't allowed — keep comments about the bill, not promotion." };
  if (PHONE.test(t)) return { ok: false, reason: "Please don't post phone numbers." };
  if (PROMO.test(t)) return { ok: false, reason: "This reads like promotion — comments should be about the bill." };
  if (REPEAT.test(t)) return { ok: false, reason: "Please write a real comment (no spammy character runs)." };

  const letters = t.replace(/[^a-z]/gi, "");
  const caps = t.replace(/[^A-Z]/g, "");
  if (letters.length > 15 && caps.length / letters.length > 0.7) return { ok: false, reason: "Please don't write entirely in capitals." };

  const alnum = t.replace(/[^a-z0-9]/gi, "");
  if (t.length > 10 && alnum.length / t.length < 0.4) return { ok: false, reason: "This looks like nonsense — please write a real comment." };

  return { ok: true };
}

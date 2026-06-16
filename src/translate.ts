/**
 * Bill translator — legalese → plain English, with key points shown in BOTH plain English and the
 * original legalese (the #7 spec). Powered by the Anthropic API; activates when ANTHROPIC_API_KEY is
 * set, and degrades cleanly to "not enabled" otherwise (same pattern as Stripe/FEC/etc.).
 *
 * COST CONTROLS (always-on cost-optimizer applies — this is the priciest call in the app):
 *   - Cheapest RELIABLE model by default (Sonnet; override via TRANSLATE_MODEL). Configurable so we
 *     can drop to a cheaper model per-tier later.
 *   - Hard `max_tokens` cap (output) + input length cap (we never send a whole 200-page bill).
 *   - PER-BILL CACHE in the Store: a bill is translated once, then served from cache forever — this is
 *     the token-saving core of the pricing model (#38), so the same bill never burns tokens twice.
 *   - Usage is logged per call so per-feature cost is visible.
 */
import type { Store } from "./store.ts";

const API = "https://api.anthropic.com/v1/messages";
export const MODEL = process.env.TRANSLATE_MODEL || "claude-sonnet-4-6"; // reliable; override to go cheaper
const MAX_INPUT = 6000;   // chars of bill text we send (cap cost + latency)
const MAX_TOKENS = 1024;  // output cap
const CACHE_TTL = 60 * 60 * 24 * 30; // 30 days — bills change slowly

export interface KeyPoint { plain: string; legalese: string; }
export interface Translation { plainEnglish: string; keyPoints: KeyPoint[]; }
export interface TranslateResult extends Partial<Translation> {
  enabled: boolean; cached?: boolean; model?: string; note?: string;
}

const SYSTEM =
  "You translate U.S. legislative text into plain English for ordinary citizens. Be accurate and neutral — " +
  "never invent provisions. Respond ONLY with minified JSON of the form " +
  '{"plainEnglish":"<2-4 sentence plain summary>","keyPoints":[{"plain":"<plain English>","legalese":"<the original/legal phrasing>"}]}. ' +
  "Give 3-6 key points. If the text is too thin to summarize, return an empty keyPoints array.";

/** Pure: build the request body (unit-testable without network). */
export function buildBody(text: string): string {
  return JSON.stringify({
    model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM,
    messages: [{ role: "user", content: `Translate this legislative text:\n\n${text.slice(0, MAX_INPUT)}` }],
  });
}

function parseTranslation(raw: string): Translation {
  const m = raw.match(/\{[\s\S]*\}/); // tolerate stray prose around the JSON
  const obj = JSON.parse(m ? m[0] : raw);
  return {
    plainEnglish: String(obj.plainEnglish ?? "").trim(),
    keyPoints: Array.isArray(obj.keyPoints)
      ? obj.keyPoints.slice(0, 8).map((k: any) => ({ plain: String(k?.plain ?? ""), legalese: String(k?.legalese ?? "") }))
      : [],
  };
}

/** Live call to Anthropic. Throws on non-200 so callers fall back gracefully. */
export async function translateText(text: string, key: string): Promise<Translation> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: buildBody(text),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const d: any = await res.json();
  if (d?.usage) console.log(`  [cost] translate model=${MODEL} in=${d.usage.input_tokens} out=${d.usage.output_tokens}`);
  return parseTranslation((d?.content ?? []).map((c: any) => c?.text ?? "").join(""));
}

/**
 * Translate a bill, cached per bill id. With a key: cache-hit → served free; miss → translate + cache.
 * Without a key: cleanly disabled (no fabrication).
 */
export async function getTranslation(billId: string, text: string, key: string | undefined, store: Store): Promise<TranslateResult> {
  const cacheKey = `tr:${billId}`;
  const hit = await store.get(cacheKey);
  if (hit) { try { return { enabled: true, cached: true, model: MODEL, ...(JSON.parse(hit) as Translation) }; } catch { /* re-translate */ } }
  if (!key) return { enabled: false, note: "AI translation isn't enabled yet — add ANTHROPIC_API_KEY to switch it on." };
  if (!text.trim()) return { enabled: true, note: "No bill text available to translate yet.", plainEnglish: "", keyPoints: [] };
  try {
    const t = await translateText(text, key);
    await store.put(cacheKey, JSON.stringify(t), CACHE_TTL); // never pay to translate this bill again
    return { enabled: true, cached: false, model: MODEL, ...t };
  } catch (e) {
    return { enabled: true, note: `Translation unavailable (${e instanceof Error ? e.message : "error"}).` };
  }
}

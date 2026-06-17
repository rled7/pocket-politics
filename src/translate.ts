/**
 * Bill translator — legalese → plain English + key points in BOTH plain English and legalese (#7).
 *
 * PROVIDER-AGNOSTIC: works with whichever AI key you have —
 *   - Anthropic native (ANTHROPIC_API_KEY, sk-ant-…), or
 *   - any OpenAI-compatible endpoint (OPENAI_API_KEY + optional OPENAI_BASE_URL): OpenRouter
 *     (https://openrouter.ai/api/v1, sk-or-…), OpenAI, or a local Ollama (http://localhost:11434/v1).
 * Activates as soon as either key is set; otherwise degrades cleanly to "not enabled" (no fabrication).
 *
 * COST CONTROLS (always-on): cheap model by default, hard max_tokens + input caps, per-bill cache in the
 * Store (translate once, serve free forever — the token-saving core of pricing #38), usage logged.
 */
import type { Store } from "./store.ts";
import { KEYS } from "./config.ts";

const MAX_INPUT = 6000, MAX_TOKENS = 1024, CACHE_TTL = 60 * 60 * 24 * 30;

const SYSTEM =
  "You translate U.S. legislative text into plain English for ordinary citizens. Be accurate and neutral — " +
  "never invent provisions. Respond ONLY with minified JSON: " +
  '{"plainEnglish":"<2-4 sentence plain summary>","keyPoints":[{"plain":"<plain English>","legalese":"<original/legal phrasing>"}]}. ' +
  "Give 3-6 key points. If the text is too thin, return an empty keyPoints array.";

export interface KeyPoint { plain: string; legalese: string; }
export interface Translation { plainEnglish: string; keyPoints: KeyPoint[]; }
export interface TranslateResult extends Partial<Translation> { enabled: boolean; cached?: boolean; model?: string; note?: string; }

/** Resolve which provider to use from configured keys. Anthropic wins if both are set. */
function provider() {
  if (KEYS.anthropic) return { kind: "anthropic" as const, key: KEYS.anthropic, base: "https://api.anthropic.com/v1", model: KEYS.llmModel || "claude-sonnet-4-6" };
  if (KEYS.openai) return { kind: "openai" as const, key: KEYS.openai, base: (KEYS.openaiBase || "https://api.openai.com/v1").replace(/\/$/, ""), model: KEYS.llmModel || "gpt-4o-mini" };
  return null;
}
export function providerName(): string | null { return provider()?.kind ?? null; }

/** Pure, unit-testable request builder for each provider. */
export function buildBody(text: string, p: NonNullable<ReturnType<typeof provider>>): string {
  const content = `Translate this legislative text:\n\n${text.slice(0, MAX_INPUT)}`;
  if (p.kind === "anthropic") return JSON.stringify({ model: p.model, max_tokens: MAX_TOKENS, system: SYSTEM, messages: [{ role: "user", content }] });
  return JSON.stringify({ model: p.model, max_tokens: MAX_TOKENS, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] });
}

function parseTranslation(raw: string): Translation {
  const m = raw.match(/\{[\s\S]*\}/); const obj = JSON.parse(m ? m[0] : raw);
  return {
    plainEnglish: String(obj.plainEnglish ?? "").trim(),
    keyPoints: Array.isArray(obj.keyPoints) ? obj.keyPoints.slice(0, 8).map((k: any) => ({ plain: String(k?.plain ?? ""), legalese: String(k?.legalese ?? "") })) : [],
  };
}

async function callLLM(text: string, p: NonNullable<ReturnType<typeof provider>>): Promise<Translation> {
  const url = p.kind === "anthropic" ? `${p.base}/messages` : `${p.base}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (p.kind === "anthropic") { headers["x-api-key"] = p.key!; headers["anthropic-version"] = "2023-06-01"; }
  else headers["authorization"] = `Bearer ${p.key}`;
  const res = await fetch(url, { method: "POST", headers, body: buildBody(text, p) });
  if (!res.ok) throw new Error(`${p.kind} ${res.status}`);
  const d: any = await res.json();
  const u = d?.usage; if (u) console.log(`  [cost] translate ${p.kind}/${p.model} in=${u.input_tokens ?? u.prompt_tokens} out=${u.output_tokens ?? u.completion_tokens}`);
  const textOut = p.kind === "anthropic" ? (d?.content ?? []).map((c: any) => c?.text ?? "").join("") : (d?.choices?.[0]?.message?.content ?? "");
  return parseTranslation(textOut);
}

/** Translate a bill, cached per bill id; serves cache-hits free; cleanly disabled with no provider key. */
export async function getTranslation(billId: string, text: string, store: Store): Promise<TranslateResult> {
  const cacheKey = `tr:${billId}`;
  const hit = await store.get(cacheKey);
  const p = provider();
  if (hit) { try { return { enabled: true, cached: true, model: p?.model, ...(JSON.parse(hit) as Translation) }; } catch { /* re-translate */ } }
  if (!p) return { enabled: false, note: "AI translation isn't enabled yet — set ANTHROPIC_API_KEY or OPENAI_API_KEY (OpenRouter works too)." };
  if (!text.trim()) return { enabled: true, note: "No bill text available to translate yet.", plainEnglish: "", keyPoints: [] };
  try {
    const t = await callLLM(text, p);
    await store.put(cacheKey, JSON.stringify(t), CACHE_TTL);
    return { enabled: true, cached: false, model: p.model, ...t };
  } catch (e) { return { enabled: true, note: `Translation unavailable (${e instanceof Error ? e.message : "error"}).` }; }
}

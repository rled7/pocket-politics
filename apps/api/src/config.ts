/**
 * Central registry of API keys / integrations for Pocket Politics.
 *
 * Config is INJECTED, never read from a global: each host entry builds a `Config` once from its
 * own environment — `loadConfig(process.env)` in `node.ts`, `loadConfig(env)` (the Workers env
 * bindings) in `worker.ts` — and hands it to `createApp`. App code therefore never touches
 * `process.env`, which doesn't exist on Workers (decoupling rule 1, PHASES.md).
 * Locally the values come from the gitignored `.dev.vars`; in prod from Cloudflare secrets.
 *
 * Centralizing means: one typed place, no secrets in source, and a cheap `integrations()` status
 * (booleans only) the UI can show without leaking values.
 *
 * NOTE: keys are wired in but their *features* may still be deferred — having the
 * key registered here is what makes a future feature a drop-in, not a refactor.
 */

/** Anything key-value shaped: `process.env`, a Workers `env` object, or a test fixture. */
export type ConfigSource = Record<string, unknown>;

/** Non-string values (e.g. a KV binding on the Workers env) are ignored; blank strings are unset. */
const pick = (source: ConfigSource, k: string): string | undefined => {
  const v = source[k];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

export interface Integration {
  /** stable id used in code + the UI status */
  id: string;
  /** human label */
  label: string;
  /** where to get the key (so a missing one is self-documenting) */
  signup: string;
  /** the resolved value, or undefined if not configured */
  value?: string;
}

/** Every key the app knows about, resolved. Undefined = not configured. */
export interface Config {
  congress?: string;   // federal: members, bills, votes, Congressional Record
  fec?: string;         // campaign finance
  lda?: string;         // Senate Lobbying Disclosure (lda.senate.gov)
  // NY State Senate Open Legislation — bills, NY laws, session transcripts (since 1993),
  // committee agendas, floor calendars, Senate/Assembly membership. `nyOpenLeg2` is a spare key.
  nyOpenLeg?: string;
  nyOpenLeg2?: string;
  openStates?: string;  // all-50-states legislators + bills (tight free tier)
  stripeSecret?: string;       // payments (hosted Checkout) — server-side only
  stripePublishable?: string;
  stripeWebhookSecret?: string;
  /** Stripe Price IDs per self-serve tier id (see TIERS in payments.ts). */
  stripePrices: { plus?: string; pro?: string; unlimited?: string };
  anthropic?: string;   // AI: Anthropic-native (sk-ant-…)
  // OpenAI-compatible providers (OpenRouter, OpenAI, local Ollama) — one code path, base URL configurable.
  openai?: string;      // sk-or-… (OpenRouter) / sk-… (OpenAI) / any
  openaiBase?: string;  // e.g. https://openrouter.ai/api/v1 ; default api.openai.com
  llmModel?: string;    // override model per provider
}

/** Resolve the config from an environment-like object. Pure: no globals, no I/O. */
export function loadConfig(source: ConfigSource): Config {
  const e = (k: string) => pick(source, k);
  return {
    congress: e("CONGRESS_API_KEY"),
    fec: e("FEC_API_KEY"),
    lda: e("LDA_API_KEY"),
    nyOpenLeg: e("NY_OPENLEG_API_KEY"),
    nyOpenLeg2: e("NY_OPENLEG_API_KEY_2"),
    openStates: e("OPENSTATES_API_KEY"),
    stripeSecret: e("STRIPE_SECRET_KEY"),
    stripePublishable: e("STRIPE_PUBLISHABLE_KEY"),
    stripeWebhookSecret: e("STRIPE_WEBHOOK_SECRET"),
    stripePrices: {
      plus: e("STRIPE_PRICE_PLUS"),
      pro: e("STRIPE_PRICE_PRO"),
      unlimited: e("STRIPE_PRICE_UNLIMITED"),
    },
    anthropic: e("ANTHROPIC_API_KEY"),
    openai: e("OPENAI_API_KEY"),
    openaiBase: e("OPENAI_BASE_URL"),
    llmModel: e("TRANSLATE_MODEL"),
  };
}

function registry(c: Config): Integration[] {
  return [
    { id: "congress",  label: "Congress.gov (federal)",        signup: "https://api.congress.gov/sign-up/",                 value: c.congress },
    { id: "fec",       label: "FEC (campaign finance)",        signup: "https://api.open.fec.gov/developers/",              value: c.fec },
    { id: "lda",       label: "Senate Lobbying Disclosure",    signup: "https://lda.senate.gov/api/",                       value: c.lda },
    { id: "nyOpenLeg", label: "NY Open Legislation",           signup: "https://legislation.nysenate.gov/#!/signup",        value: c.nyOpenLeg },
    { id: "openStates", label: "OpenStates (all 50 states)",   signup: "https://open.pluralpolicy.com/accounts/signup/",    value: c.openStates },
    { id: "stripe",     label: "Stripe (payments)",            signup: "https://dashboard.stripe.com/apikeys",              value: c.stripeSecret },
    { id: "anthropic",  label: "Anthropic (AI translation)",   signup: "https://console.anthropic.com/settings/keys",       value: c.anthropic },
    { id: "openai",     label: "OpenAI-compatible AI (OpenRouter/OpenAI)", signup: "https://openrouter.ai/keys",          value: c.openai },
  ];
}

/** Secrets-safe status: which integrations are configured. Never returns key values. */
export function integrations(config: Config): Array<Omit<Integration, "value"> & { configured: boolean }> {
  return registry(config).map(({ value, ...meta }) => ({ ...meta, configured: Boolean(value) }));
}

/** One-line boot summary for logs, e.g. "congress✓ fec✗ lda✓ nyOpenLeg✓". */
export function keySummary(config: Config): string {
  return registry(config).map(i => `${i.id}${i.value ? "✓" : "✗"}`).join(" ");
}

/**
 * Central registry of API keys / integrations for Pocket Politics.
 *
 * Every key the app knows about lives here — read once from the environment
 * (locally from the gitignored `.dev.vars`, in prod from Cloudflare secrets).
 * Centralizing means: one typed place, no secrets in source, and a cheap
 * `integrations()` status (booleans only) the UI can show without leaking values.
 *
 * NOTE: keys are wired in but their *features* may still be deferred — having the
 * key registered here is what makes a future feature a drop-in, not a refactor.
 */

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
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

/** All known keys. Add new integrations here as they come online. */
export const KEYS = {
  congress:   env("CONGRESS_API_KEY"),   // federal: members, bills, votes, Congressional Record
  fec:        env("FEC_API_KEY"),         // campaign finance
  lda:        env("LDA_API_KEY"),         // Senate Lobbying Disclosure (lda.senate.gov)
  nyOpenLeg:  env("NY_OPENLEG_API_KEY"),  // NY State Senate Open Legislation
  // pasted alongside the "black & white" note; service not yet confirmed.
  unconfirmedBW: env("UNCONFIRMED_KEY_BW"),
} as const;

const REGISTRY: Integration[] = [
  { id: "congress",  label: "Congress.gov (federal)",        signup: "https://api.congress.gov/sign-up/",                 value: KEYS.congress },
  { id: "fec",       label: "FEC (campaign finance)",        signup: "https://api.open.fec.gov/developers/",              value: KEYS.fec },
  { id: "lda",       label: "Senate Lobbying Disclosure",    signup: "https://lda.senate.gov/api/",                       value: KEYS.lda },
  { id: "nyOpenLeg", label: "NY Open Legislation",           signup: "https://legislation.nysenate.gov/#!/signup",        value: KEYS.nyOpenLeg },
];

/** Secrets-safe status: which integrations are configured. Never returns key values. */
export function integrations(): Array<Omit<Integration, "value"> & { configured: boolean }> {
  return REGISTRY.map(({ value, ...meta }) => ({ ...meta, configured: Boolean(value) }));
}

/** One-line boot summary for logs, e.g. "congress✓ fec✗ lda✓ nyOpenLeg✓". */
export function keySummary(): string {
  return REGISTRY.map(i => `${i.id}${i.value ? "✓" : "✗"}`).join(" ");
}

/**
 * Payments — Stripe Checkout (hosted). We never touch card data: the server creates a Checkout
 * Session via Stripe's REST API and redirects the user to Stripe's hosted page, so PCI scope stays
 * minimal. No SDK dependency — we call the API with `fetch` + form-encoding, like our other clients.
 *
 * SETUP (what to provide before this goes live):
 *   1. STRIPE_SECRET_KEY (sk_live_… / sk_test_…) in .dev.vars / Cloudflare secrets.
 *   2. Create Products + Prices in the Stripe dashboard, then set their Price IDs:
 *        STRIPE_PRICE_PLUS, STRIPE_PRICE_PRO, STRIPE_PRICE_UNLIMITED
 *   3. (Later, for fulfillment) STRIPE_WEBHOOK_SECRET to verify webhook events.
 * Until the secret key is set, the API returns a clean "payments not configured" — nothing breaks.
 */

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

export interface Tier {
  id: string; name: string; blurb: string; price: string;
  mode: "payment" | "subscription"; priceEnv: string;
}

/** Citizen-side self-serve tiers. Non-profit & politician tiers are verification-gated (see #15/#46). */
export const TIERS: Tier[] = [
  { id: "plus", name: "Plus", blurb: "A few full AI bill breakdowns when you need them.", price: "$1", mode: "payment", priceEnv: "STRIPE_PRICE_PLUS" },
  { id: "pro", name: "Pro", blurb: "Lots of AI breakdowns + summaries every month.", price: "$10/mo", mode: "subscription", priceEnv: "STRIPE_PRICE_PRO" },
  { id: "unlimited", name: "Unlimited", blurb: "Unlimited AI breakdowns, capped fairly.", price: "Unlimited", mode: "subscription", priceEnv: "STRIPE_PRICE_UNLIMITED" },
];

export function paymentsConfigured(secret?: string): boolean {
  return Boolean(secret);
}

/** Public tier list for the pricing page (no secrets). */
export function tiersPublic(): Array<Omit<Tier, "priceEnv">> {
  return TIERS.map(({ priceEnv, ...t }) => t);
}

/** Build the x-www-form-urlencoded body for a Checkout Session (pure — unit-testable, no network). */
export function buildCheckoutForm(priceId: string, mode: string, successUrl: string, cancelUrl: string): string {
  const p = new URLSearchParams();
  p.set("mode", mode);
  p.set("line_items[0][price]", priceId);
  p.set("line_items[0][quantity]", "1");
  p.set("success_url", successUrl);
  p.set("cancel_url", cancelUrl);
  p.set("allow_promotion_codes", "true");
  return p.toString();
}

export interface CheckoutResult { url?: string; error?: string; }

/**
 * Create a Stripe Checkout Session for a tier and return the hosted-checkout URL.
 * `priceId` comes from the tier's env var (set after you create Prices in Stripe).
 */
export async function createCheckout(tierId: string, origin: string, secret?: string): Promise<CheckoutResult> {
  if (!secret) return { error: "Payments are not configured yet (no Stripe key)." };
  const tier = TIERS.find(t => t.id === tierId);
  if (!tier) return { error: "Unknown plan." };
  const priceId = process.env[tier.priceEnv]?.trim();
  if (!priceId) return { error: `This plan isn't set up yet (missing ${tier.priceEnv}).` };

  const body = buildCheckoutForm(priceId, tier.mode, `${origin}/pricing.html?paid=1`, `${origin}/pricing.html?canceled=1`);
  try {
    const res = await fetch(STRIPE_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const d: any = await res.json();
    if (!res.ok) return { error: d?.error?.message ?? `Stripe error ${res.status}` };
    return { url: d?.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "checkout failed" };
  }
}

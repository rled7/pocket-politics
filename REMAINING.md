# Pocket Politics — what's left (snapshot 2026-06-20, build 94)

45 of 58 tracked tasks done. **Every remaining item is blocked on a user-provided key or decision** —
there is no unblocked coding work left. Listed with the exact thing that unblocks each.

## 🔑 Needs an AI key (Anthropic `sk-ant` OR OpenRouter `sk-or` — translator is provider-agnostic)
- **#7 Bill translator** — legalese → plain English. *Pipeline fully scaffolded* in `src/translate.ts`;
  degrades to "not configured" today. Drop a key → verify live on one bill → then:
- **#31 Multilingual i18n** — 5 languages + Spanish dialects.
- **#32 Senate transcript summaries** — the *access* half is live (`/api/record`, NY transcripts in-app);
  only the plain-language AI summary needs the key.
- **#44 AI-relevant lobbying** — parse a member's LDA filings → "what they actually work on."
  > Discipline (user's rule): get the key → verify ONE feature live → build the other three on that base.
  > Do NOT blind-scaffold all four at once.

## 💳 Needs a vendor key / paid data
- **#38 Pricing tiers** — *scaffolded* (`payments.ts`, `pricing.html`, `/api/checkout`). Needs Stripe
  secret + 3 Price IDs.
- **#41 Influence patterns** — lobbying × stock trades × news. Needs a paid/structured stock-trade
  disclosure source (House/Senate filings are public but scattered PDFs).
- **#27 Official portraits** — presidents/justices. Needs a verified, licensed/stable image source
  (hotlinking flagged fragile).

## 🪪 Needs a vendor pick + legal check (the revenue chain)
- **#46 Identity verification engine** — gov ID → registered voter → district. Pick an IDV vendor + NY
  voter-file legal review FIRST (PII).
- **#15 Accounts + email verification + moderation** — moderation logic exists; needs an email provider
  and builds on #46.
- **#45 District-targeted messaging** ("BBM for politicians") — depends on #46/#15.

## 🧭 Needs a user decision / action
- **#53 Election-integrity / flagged polling sites** — ⚠️ HIGH RISK. Needs explicit scope sign-off
  (authoritative data only) before any build.
- **#54 Deploy as live demo** — needs the user's `wrangler login` (interactive Cloudflare auth), then
  ship + list on remberllc.
- **#16 Security red-team/blue-team pass** — *by design the FINAL step, after feature lock.* v1 already
  shipped (headers/CSP/input-allowlist); audit 2026-06-20 confirmed new endpoints use
  `encodeURIComponent` on user path segments — no known hole. Do the full pass once features are frozen.

## State
master @ build 94, 123/123 tests green, typecheck clean, pushed to github.com/rled7/pocket-politics.

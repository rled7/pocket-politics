# COMPLIANCE.md — Pocket Politics

Working template, not legal advice. Have a lawyer review before launch.
Pocket Politics handles political opinions, union membership and home location, which are among
the most sensitive categories of personal data.

## 1. Privacy Policy

Status: ☐ not drafted

Must cover, at minimum:
- What we collect (section 3) and why
- That union, tenant-association and civic memberships are **private by default**, and how to change that
- A separate opt-in for being counted in aggregate statistics
- That a street address is used to find districts and is not stored (from task 2.7)
- Which third parties receive data: U.S. Census geocoder, AI provider (bill text only), Stripe, Google Fonts
- How to export and delete your data
- That we never sell or share membership data with employers, landlords, or campaigns

## 2. Terms of Service

Status: ☐ not drafted

Must cover: acceptable use for political content, moderation and appeals, impersonation of
officials or organizations, verified-org claims, no voter intimidation or doxxing.

## 3. Data-collection inventory

### Collected today (build 95)

| Data | Where | Purpose | GDPR basis | CCPA/CPRA | Visibility | Retention |
|---|---|---|---|---|---|---|
| Commenter name, district, text | KV `comments:{bill}` | Bill comments | Art. 9 (political opinions): explicit consent | Personal info | Public | Last 1,000 per bill, no expiry |
| Commenter email | KV, same record | Future verification | Art. 6(1)(a) consent | Personal info | Never returned by the API | Same as comment |
| Reaction + random device id | KV `rxuser:*`, browser `pp_cid` | Bill reactions | Art. 9 (political opinions): explicit consent | Personal info (device id) | Counts public | No expiry |
| Address or coordinates for "my reps" | Sent to Census geocoder; URL is the cache key (edge + memory cache); request URL appears in error logs | Find district | Art. 6(1)(a) consent | **Sensitive: precise geolocation** | Echoed back in the response | Cache TTL; log retention TBD |
| IP address | In-memory rate limiter; error logs | Abuse prevention | Art. 6(1)(f) legitimate interest | Personal info | Never exposed | 1 min (limiter); logs TBD |
| Page views by bill/member id | KV `trending:*`, `views:*` | Trending, cache optimizer | No personal data | — | Aggregates public | No expiry |
| Section usage, remembered home, ad preference | Browser only (`pp_affinity`, `pp_home`, `pp_remove_ads`) | Personalization | Art. 6(1)(f); ePrivacy for device storage | Personal info (device) | Never leaves the browser | Until cleared |
| Visitor IP to Google Fonts | Browser → fonts.googleapis.com | Typography | Third-party transfer (EU risk) | Disclosure | — | Google's policy |
| Bill text | Sent to AI provider when translation is enabled | Plain-language translation | No personal data | — | — | Provider policy |
| Payment details | Stripe hosted checkout (never touches our servers) | Paid tiers | Art. 6(1)(b) contract | Personal info | — | Stripe |

### Planned (PHASES Phase 2+)

| Data | Table | Purpose | GDPR basis | CCPA/CPRA | Default visibility | Retention |
|---|---|---|---|---|---|---|
| Email | users.email | Login, notices | Art. 6(1)(b) contract | Personal info | Private | Account life |
| Handle, display name | users | Public identity | Art. 6(1)(b) | Personal info | Public | Account life |
| Password hash / sessions | users, sessions | Auth | Art. 6(1)(b) | Account credentials (sensitive) | Never exposed | Account life |
| Home point + postcode | residences | District assignment | Art. 6(1)(a) consent | **Sensitive: precise geolocation** | Never exposed | Account life; history on move |
| District memberships | memberships (geo) | Who represents me, district boards | Art. 6(1)(a) consent | Derived from geolocation | Private | Account life |
| Union membership | memberships (labor_union) | Union boards | **Art. 9 special category: explicit consent** | **Sensitive: union membership** | Private | Until user leaves + history |
| Tenant / civic memberships | memberships | Group boards | Art. 6(1)(a) consent | Personal info | Private | Until user leaves + history |
| Ideas, comments, likes | ideas, comments, idea_likes | Core product | **Art. 9 (political opinions): explicit consent** | Personal info | Public | Account life |
| Aggregate-count consent | memberships.count_in_stats | Overlap statistics | Art. 9(2)(a) explicit consent | Opt-in | — | Per membership |
| Reports filed | reports | Moderation | Art. 6(1)(f) legitimate interest | Personal info | Hidden from reported user | TBD |
| Government ID / voter match (4.8) | IDV vendor | Verified constituent | Explicit consent; vendor DPA | **Sensitive: government ID** | Never stored by us | Vendor policy |

### Open items
- ☐ Strip address/coordinates from error logs and make `/api/reps` responses `private` (no shared cache) — before deploy (5.6)
- ☐ Self-host fonts or document the Google Fonts transfer
- ☐ Migrate existing KV comments/emails with the 2.4 migration; decide what happens to unverified emails
- ☐ Encryption at rest for residences and memberships (Neon encrypts storage; confirm and document)
- ☐ Data export and delete endpoints (hard delete cascades; SQL test T20)
- ☐ Retention for logs, ended memberships, and old residences
- ☐ k-threshold value and differencing-attack review for overlap stats
- ☐ Confirm whether GDPR applies (EU users?) or design to it anyway

## 4. Name clearance (USPTO)

Status: ☐ not checked

- ☐ USPTO trademark search for "Pocket Politics" (class 9 software, class 42 SaaS, others as relevant)
- ☐ App Store / Play Store name availability
- ☐ Domain and social handles
- Do not finalize the name until this is done.

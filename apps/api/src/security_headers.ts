/**
 * Security headers applied to every response (static + API). The app is inline-script heavy, so the
 * CSP allows 'unsafe-inline' for scripts but still locks down object/base/frame and restricts where
 * scripts, styles, images, and fetches may come from — defense-in-depth on top of output escaping.
 *
 * ONE definition, three places that apply it:
 *   - `app.ts`   — middleware on every response the Hono app produces (API + /healthz + 404s)
 *   - `node.ts`  — the Node server's static-file responses
 *   - `apps/web/_headers` — Workers static assets are served WITHOUT running any Worker code, so
 *     the same list is repeated there as a file. A test (app.test.ts) fails if the two drift.
 */

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), microphone=(), camera=()",
  "Content-Security-Policy": CSP,
  // HTTPS-only once deployed (Cloudflare terminates TLS); harmless over local HTTP. 1 year + preload.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Set every security header on a (mutable) Headers object. */
export function applySecurityHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
}

/**
 * Response headers for every page and API route (applied in next.config.ts).
 *
 * Enforced now: no framing by other sites (clickjacking on checkout), no plugins,
 * no <base> hijacking, no MIME sniffing, HTTPS-only for a year, a referrer that
 * never carries paths or tokens to other sites, and no camera/mic/location.
 *
 * Report-only for now: the full resource policy (scripts, frames, connections).
 * It lists Stripe's documented hosts for the Payment Element, Link, wallets and the
 * address form. Browsers log any violation in the console without blocking it.
 * Once a live checkout shows no violations, move it to the enforced header.
 */
type Options = { dev: boolean; waitVideoUrl?: string; sentryDsn?: string };

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(o: Options): string {
  const video = origin(o.waitVideoUrl);
  // Browser error reports go to the DSN's ingest host.
  const sentry = origin(o.sentryDsn?.replace(/\/\/[^@/]*@/, "//"));
  return [
    "default-src 'self'",
    // Next.js inlines its bootstrap scripts; the dev server also needs eval for hot reload.
    `script-src 'self' 'unsafe-inline'${o.dev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://*.js.stripe.com https://maps.googleapis.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.stripe.com",
    `media-src 'self' blob:${video ? ` ${video}` : ""}`,
    `connect-src 'self' https://api.stripe.com https://*.stripe.com https://maps.googleapis.com${sentry ? ` ${sentry}` : ""}${o.dev ? " ws: wss:" : ""}`,
    // Stripe's payment frames, and Cloudflare Turnstile's check on the quiz's last screen.
    "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(o: Options): { key: string; value: string }[] {
  return [
    // Safe to enforce today: none of these can block the site's own scripts, styles or Stripe.
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(o) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Ignored by browsers over plain http, so harmless locally.
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
    // payment is left alone on purpose: Apple Pay and Google Pay run inside Stripe's frames.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}

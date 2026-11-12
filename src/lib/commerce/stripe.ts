/**
 * Stripe: Checkout Sessions for our own checkout page (ui_mode "elements": the Payment
 * Element inside our page, so card, Link, Apple Pay and Google Pay), Stripe Tax through
 * automatic_tax, and webhook signature checks.
 *
 * The price is always the server's (env.songPriceCents); the browser never sends one.
 * Our order id travels in the session's (and its PaymentIntent's) metadata and is
 * checked on the way back.
 */
import Stripe from "stripe";
import { env } from "../env";

let client: Stripe | null = null;

/** The Stripe client. Signature checks work without a secret key, so tests can verify events offline. */
export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(env.stripe.secretKey || "sk_test_signature_checks_only", {
      maxNetworkRetries: 2,
      timeout: 20_000,
      // fetch honours HTTPS_PROXY (NODE_USE_ENV_PROXY=1) where a host routes egress through a proxy.
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return client;
}

/** Tags our sessions in the Dashboard so this checkout flow can be told apart from others. */
export const INTEGRATION_IDENTIFIER = "cryworthy-song-elements-qhzmtwrk";

export type SessionRef = { id: string; clientSecret: string; status: Stripe.Checkout.Session.Status | null };

/**
 * Create the Checkout Session for one order. The idempotency key is the order id plus the
 * session it replaces, so a double click returns the same session instead of a second one,
 * while an expired session can still be replaced.
 */
export async function createCheckoutSession(
  order: { id: string; requestId: string; versionId: string },
  opts: { email?: string | null; productName: string; description: string; replaces?: string | null },
): Promise<SessionRef> {
  const metadata = { order_id: order.id, request_id: order.requestId, version_id: order.versionId };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    ui_mode: "elements",
    integration_identifier: INTEGRATION_IDENTIFIER,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: env.currency,
          unit_amount: env.songPriceCents,
          tax_behavior: env.stripe.taxBehavior,
          product_data: { name: opts.productName, description: opts.description, tax_code: env.stripe.taxCode },
        },
      },
    ],
    // Our post-purchase page confirms the session with Stripe; wallets and 3-D Secure come back here.
    return_url: `${env.appUrl}/checkout/${order.id}/complete?session_id={CHECKOUT_SESSION_ID}`,
    customer_email: opts.email || undefined,
    // Tax is calculated from the billing address the buyer enters (Address Element on our page).
    ...(env.stripe.automaticTax ? { automatic_tax: { enabled: true } } : {}),
    metadata,
    payment_intent_data: { description: opts.description, metadata },
  };
  const cs = await stripe().checkout.sessions.create(params, { idempotencyKey: `song-order:${order.id}:${opts.replaces ?? "first"}` });
  return { id: cs.id, clientSecret: cs.client_secret ?? "", status: cs.status };
}

export async function retrieveCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
  return stripe().checkout.sessions.retrieve(id);
}

/** Legacy orders (before Checkout Sessions) were paid with a bare PaymentIntent. */
export async function retrieveIntent(id: string): Promise<Stripe.PaymentIntent> {
  return stripe().paymentIntents.retrieve(id);
}

/** Verify a webhook delivery against STRIPE_WEBHOOK_SECRET. Returns null when the signature doesn't match. */
export function verifyEvent(rawBody: string, signature: string | null, secret = env.stripe.webhookSecret): Stripe.Event | null {
  if (!signature || !secret) return null;
  try {
    return stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return null;
  }
}

/** Build a valid signature header for a payload. Tests and the local smoke script only. */
export function signForTests(rawBody: string, secret: string): string {
  return stripe().webhooks.generateTestHeaderString({ payload: rawBody, secret });
}

export type { Stripe };

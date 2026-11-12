/**
 * Stripe: PaymentIntents for the custom checkout (card, Link, Apple Pay and
 * Google Pay through the Payment Element) and webhook signature checks.
 *
 * The price is always the server's (env.songPriceCents); the browser never sends one.
 * Our order id travels in the PaymentIntent's metadata and is checked on the way back.
 */
import Stripe from "stripe";
import { env } from "../env";

let client: Stripe | null = null;

/** The Stripe client. Signature checks work without a secret key, so tests can verify events offline. */
export function stripe(): Stripe {
  if (!client) client = new Stripe(env.stripe.secretKey || "sk_test_signature_checks_only", { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export type IntentRef = { id: string; clientSecret: string; status: Stripe.PaymentIntent.Status };

/**
 * Create the PaymentIntent for one order. The idempotency key is the order id, so a
 * double click or a retried request returns the same intent instead of a second charge.
 */
export async function createIntent(order: { id: string; requestId: string; versionId: string }, opts: { email?: string | null; description: string }): Promise<IntentRef> {
  const pi = await stripe().paymentIntents.create(
    {
      amount: env.songPriceCents,
      currency: env.currency,
      // Card, Link, Apple Pay, Google Pay and whatever else is switched on in the Stripe dashboard.
      automatic_payment_methods: { enabled: true },
      description: opts.description,
      receipt_email: opts.email || undefined,
      metadata: { order_id: order.id, request_id: order.requestId, version_id: order.versionId },
    },
    { idempotencyKey: `song-order:${order.id}` },
  );
  return { id: pi.id, clientSecret: pi.client_secret ?? "", status: pi.status };
}

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

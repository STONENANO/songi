import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/commerce/orders";

export const runtime = "nodejs";

/**
 * Stripe webhooks: checkout.session.completed / .async_payment_succeeded / .async_payment_failed,
 * payment_intent.payment_failed, charge.refunded (and payment_intent.succeeded / .canceled for older orders).
 * The signature is checked over the raw body (STRIPE_WEBHOOK_SECRET).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const out = await handleStripeWebhook(raw, req.headers);
  return NextResponse.json({ result: out.result }, { status: out.status });
}

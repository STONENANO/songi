/**
 * Orders: from "Get the full song" to a verified, fulfilled purchase, paid with Stripe.
 *
 * - The server decides what is bought and what it costs. The client only names a
 *   version id, which must belong to the caller's project and be on offer.
 * - Nothing is unlocked by a browser redirect alone. An order is paid only when
 *   Stripe says so: a signed webhook, or the Checkout Session fetched from Stripe when
 *   the buyer returns from checkout. Amount, currency and our order id are checked.
 * - Tax (Stripe Tax, when STRIPE_AUTOMATIC_TAX is on) is added by Stripe on top of the
 *   price; we check the pre-tax subtotal against our price and record the tax.
 * - Fulfilment is idempotent: webhook deliveries are de-duplicated by event id,
 *   and the order row is claimed with a conditional update.
 */
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Order } from "../db/schema";
import { env } from "../env";
import { getStorage } from "../storage";
import { assertSafeAudioUrl } from "../kie/client";
import { downloadToFile, normalizeToMp3 } from "../audio/ffmpeg";
import { logEvent, setStatus } from "../pipeline/common";
import { reportError, reportIssue } from "../observability";
import { sendPurchaseEmail } from "../email";
import { formatPrice, getCheckoutPrice, getSongPrice, invalidateSongPrice } from "./pricing";
import { createCheckoutSession, retrieveCheckoutSession, retrieveIntent, verifyEvent, type Stripe } from "./stripe";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { orders, songVersions, songRequests, webhookReceipts } = schema;

export const checkoutPath = (orderId: string) => `/checkout/${orderId}`;

export type CheckoutResult = { ok: true; checkoutUrl: string; orderId: string; reused: boolean } | { ok: false; error: string; status: number };

/** "Get the full song": validate the version, create (or reuse) a pending order, send the buyer to our checkout page. */
export async function startCheckout(requestId: string, versionId: string): Promise<CheckoutResult> {
  const db = await getDb();
  const [v] = await db.select().from(songVersions).where(and(eq(songVersions.id, versionId), eq(songVersions.requestId, requestId))).limit(1);
  if (!v) return { ok: false, error: "That version does not belong to this song.", status: 404 };
  if (v.purchaseStatus === "paid") return { ok: false, error: "This version is already purchased.", status: 409 };
  if (!v.offered || v.status !== "ready" || v.availability !== "available") return { ok: false, error: "That version is not available to buy.", status: 409 };
  if (!v.audioKey || !(await (await getStorage()).exists(v.audioKey))) return { ok: false, error: "That version's audio is not available. Please choose another.", status: 409 };

  // Selecting is part of buying.
  await db.update(songVersions).set({ selected: false }).where(eq(songVersions.requestId, requestId));
  await db.update(songVersions).set({ selected: true }).where(eq(songVersions.id, versionId));
  await db.update(songRequests).set({ selectedVersionId: versionId, updatedAt: new Date() }).where(eq(songRequests.id, requestId));

  // Reuse a recent pending order for the same version (abandoned or interrupted checkout).
  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.versionId, versionId), eq(orders.status, "pending"), gt(orders.createdAt, new Date(Date.now() - 24 * 3600_000))))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (existing) {
    await logEvent(requestId, "checkout:reused", { orderId: existing.id, versionId });
    return { ok: true, checkoutUrl: checkoutPath(existing.id), orderId: existing.id, reused: true };
  }

  // The price shown when they clicked; the checkout session records what it actually sells.
  const price = await getSongPrice();
  const [order] = await db
    .insert(orders)
    .values({ requestId, versionId, status: "pending", offerId: "song", amountCents: price.cents, currency: price.currency })
    .returning();
  await db.update(songVersions).set({ purchaseStatus: "pending" }).where(and(eq(songVersions.id, versionId), ne(songVersions.purchaseStatus, "paid")));
  await logEvent(requestId, "checkout:started", { orderId: order.id, versionId, mock: env.mockPayments });
  return { ok: true, checkoutUrl: checkoutPath(order.id), orderId: order.id, reused: false };
}

export type PreparedCheckout =
  | { kind: "paid" }
  | { kind: "closed"; reason: string }
  | { kind: "test"; free: boolean; priceLabel: string }
  | { kind: "stripe"; clientSecret: string; publishableKey: string; tax: boolean; taxExclusive: boolean; hasEmail: boolean; priceLabel: string };

/**
 * What the checkout page needs for one order: a Checkout Session client secret (created once,
 * then reused until it expires), the local test button in mock mode, or "already paid".
 */
export async function prepareCheckout(order: Order): Promise<PreparedCheckout> {
  if (order.status === "paid" || order.status === "paid_unfulfilled") return { kind: "paid" };
  if (order.status !== "pending") return { kind: "closed", reason: order.status };
  if (env.mockPayments) {
    if (!env.testCheckoutAllowed) return { kind: "closed", reason: "payments_not_configured" };
    const now = await getSongPrice();
    return { kind: "test", free: env.freeDownloads, priceLabel: formatPrice(order.amountCents ?? now.cents, order.currency ?? now.currency) };
  }

  const db = await getDb();
  // The label is the amount this session sells (the price can change in Stripe between sessions).
  const stripeMode = (clientSecret: string, hasEmail: boolean, cents: number, currency: string, taxExclusive: boolean): PreparedCheckout => ({
    kind: "stripe",
    clientSecret,
    publishableKey: env.stripe.publishableKey,
    tax: env.stripe.automaticTax,
    taxExclusive,
    hasEmail,
    priceLabel: formatPrice(cents, currency),
  });
  if (order.stripeCheckoutSessionId) {
    const cs = await retrieveCheckoutSession(order.stripeCheckoutSessionId);
    if (cs.status === "complete") {
      // Paid (or an async method such as a bank debit is still settling: the webhook finishes it).
      const result = await applyCompletedSession(cs);
      return result === "fulfilled" || result === "already_paid" ? { kind: "paid" } : { kind: "closed", reason: cs.payment_status === "unpaid" ? "payment_processing" : result };
    }
    if (cs.status === "open" && cs.client_secret)
      return stripeMode(cs.client_secret, !!cs.customer_email, order.amountCents ?? cs.amount_subtotal ?? 0, order.currency ?? cs.currency ?? env.currency, env.stripe.taxBehavior === "exclusive");
    // Expired: replace it below.
  } else if (order.stripePaymentIntentId) {
    // An order started before Checkout Sessions: if its PaymentIntent already succeeded, finish it.
    const pi = await retrieveIntent(order.stripePaymentIntentId).catch(() => null);
    if (pi?.status === "succeeded") {
      await applySucceededIntent(pi);
      return { kind: "paid" };
    }
  }
  const [r] = await db.select({ email: songRequests.email, name: songRequests.recipientName }).from(songRequests).where(eq(songRequests.id, order.requestId)).limit(1);
  const [v] = await db.select({ title: songVersions.title }).from(songVersions).where(eq(songVersions.id, order.versionId)).limit(1);
  const forName = r?.name ? ` for ${r.name}` : "";
  let cs;
  let price;
  try {
    // The live price: re-read from Stripe unless just fetched; refuses an archived or recurring one.
    price = await getCheckoutPrice();
    cs = await createCheckoutSession(order, {
      price,
      email: r?.email,
      productName: v?.title ? `${v.title} (custom song)` : `Custom song${forName}`,
      description: `Custom song${forName}: full song, MP3 download and a permanent link`,
      replaces: order.stripeCheckoutSessionId,
    });
  } catch (e) {
    // A misconfigured price (or Stripe being down) must not take the page down: say so, and alert us.
    reportIssue("Checkout could not be opened", { kind: "checkout_unavailable", orderId: order.id, requestId: order.requestId, error: (e as Error).message }, "error");
    await logEvent(order.requestId, "checkout:unavailable", { orderId: order.id, error: (e as Error).message });
    return { kind: "closed", reason: "checkout_unavailable" };
  }
  // Payments are checked against the amount this session sells.
  await db.update(orders).set({ stripeCheckoutSessionId: cs.id, amountCents: price.cents, currency: price.currency }).where(eq(orders.id, order.id));
  return stripeMode(cs.clientSecret, !!r?.email, price.cents, price.currency, price.taxBehavior === "exclusive");
}

/** The fields we rely on from a Stripe Checkout Session (webhook payload or API response). */
type SessionLike = Pick<Stripe.Checkout.Session, "id" | "status" | "payment_status" | "amount_subtotal" | "amount_total" | "currency" | "metadata" | "payment_intent" | "total_details">;

/**
 * Mark an order paid from a completed, paid Checkout Session, then fulfil it. Safe to call
 * from the webhook and the return page at the same time: only one claim wins.
 */
export async function applyCompletedSession(cs: SessionLike): Promise<string> {
  // A completed session can still be "unpaid" while a delayed method settles; wait for async_payment_succeeded.
  if (cs.payment_status !== "paid") return `not_paid:${cs.payment_status}`;
  const songOrderId = cs.metadata?.order_id;
  if (!songOrderId || !/^[0-9a-f-]{36}$/i.test(songOrderId)) return "not_a_song_order";
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, songOrderId)).limit(1);
  if (!row) return "unknown_song_order";
  if (row.stripeCheckoutSessionId && row.stripeCheckoutSessionId !== cs.id) return "session_mismatch";
  const expected = row.amountCents ?? (await getSongPrice()).cents;
  const tax = cs.total_details?.amount_tax ?? 0;
  // The price is checked before tax (tax is Stripe's to add); inclusive pricing keeps the subtotal at the price.
  if ((cs.amount_subtotal ?? 0) < expected || cs.currency !== (row.currency ?? env.currency)) {
    await logEvent(row.requestId, "order:amount_mismatch", { orderId: row.id, subtotal: cs.amount_subtotal, expected, currency: cs.currency });
    reportIssue("Paid amount does not match the order", { kind: "amount_mismatch", orderId: row.id, subtotal: cs.amount_subtotal, expected, currency: cs.currency });
    return "amount_mismatch";
  }
  const piId = typeof cs.payment_intent === "string" ? cs.payment_intent : (cs.payment_intent?.id ?? null);
  return markPaid(row, { paymentRef: piId ?? cs.id, paymentIntentId: piId, sessionId: cs.id, amountCents: cs.amount_total ?? expected, taxCents: tax, currency: cs.currency ?? env.currency });
}

/** The fields we rely on from a Stripe PaymentIntent (webhook payload or API response). */
type IntentLike = Pick<Stripe.PaymentIntent, "id" | "status" | "amount_received" | "currency" | "metadata">;

/**
 * Mark an order paid from a succeeded PaymentIntent, then fulfil it. Safe to call from the
 * webhook and from the return page at the same time: only one claim wins.
 */
export async function applySucceededIntent(pi: IntentLike): Promise<string> {
  if (pi.status !== "succeeded") return `not_succeeded:${pi.status}`;
  const songOrderId = pi.metadata?.order_id;
  if (!songOrderId || !/^[0-9a-f-]{36}$/i.test(songOrderId)) return "not_a_song_order";
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, songOrderId)).limit(1);
  if (!row) return "unknown_song_order";
  // Orders paid through a Checkout Session are settled by checkout.session.* events, not this one.
  if (row.stripeCheckoutSessionId) return "handled_by_checkout_session";
  if (row.stripePaymentIntentId && row.stripePaymentIntentId !== pi.id) return "intent_mismatch";
  const expected = row.amountCents ?? (await getSongPrice()).cents;
  if (pi.amount_received < expected || pi.currency !== (row.currency ?? env.currency)) {
    await logEvent(row.requestId, "order:amount_mismatch", { orderId: row.id, received: pi.amount_received, expected, currency: pi.currency });
    reportIssue("Paid amount does not match the order", { kind: "amount_mismatch", orderId: row.id, received: pi.amount_received, expected, currency: pi.currency });
    return "amount_mismatch";
  }
  return markPaid(row, { paymentRef: pi.id, paymentIntentId: pi.id, amountCents: pi.amount_received, currency: pi.currency });
}

type Payment = { paymentRef: string; paymentIntentId: string | null; sessionId?: string; amountCents: number; taxCents?: number; currency: string };

async function markPaid(row: Order, p: Payment): Promise<string> {
  const { paymentRef, amountCents, currency } = p;
  const db = await getDb();
  if (row.status === "paid" || row.status === "paid_unfulfilled") return "already_paid";
  // A different order already paid for the same version (two checkouts, both paid): flag for refund, never fulfil twice.
  const [otherPaid] = await db.select().from(orders).where(and(eq(orders.versionId, row.versionId), eq(orders.status, "paid"), ne(orders.id, row.id))).limit(1);
  const newStatus = otherPaid ? "duplicate_payment" : "paid";
  const claimed = await db
    .update(orders)
    .set({
      status: newStatus,
      stripePaymentIntentId: p.paymentIntentId,
      ...(p.sessionId ? { stripeCheckoutSessionId: p.sessionId } : {}),
      amountCents,
      taxCents: p.taxCents ?? 0,
      currency,
      paidAt: new Date(),
      error: otherPaid ? `Version already paid by order ${otherPaid.id}` : null,
    })
    .where(and(eq(orders.id, row.id), eq(orders.status, "pending")))
    .returning();
  if (!claimed.length) return "already_processed";
  await logEvent(row.requestId, newStatus === "paid" ? "order:paid" : "order:duplicate_payment", { orderId: row.id, paymentRef, amountCents, taxCents: p.taxCents ?? 0 });
  if (newStatus !== "paid") {
    reportIssue("Second payment for an already-paid version: refund it", { kind: "duplicate_payment", orderId: row.id, otherOrderId: otherPaid?.id ?? null });
    return "duplicate_payment";
  }
  return fulfil(claimed[0]);
}

/**
 * The buyer is back from checkout (Stripe redirects to our complete page). Ask Stripe directly
 * so the song unlocks even if the webhook is slow. Returns the order's status afterwards.
 */
export async function confirmFromReturn(orderId: string): Promise<Order | null> {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!row) return null;
  if (row.status === "pending" && !env.mockPayments) {
    if (row.stripeCheckoutSessionId) {
      const cs = await retrieveCheckoutSession(row.stripeCheckoutSessionId).catch(() => null);
      if (cs?.status === "complete") await applyCompletedSession(cs);
    } else if (row.stripePaymentIntentId) {
      const pi = await retrieveIntent(row.stripePaymentIntentId).catch(() => null);
      if (pi?.status === "succeeded") await applySucceededIntent(pi);
    }
  }
  const [after] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return after ?? null;
}

/** Test checkout (no Stripe keys, or free-download mode): pay the order through the same claim and fulfilment path. */
export async function payWithTestCheckout(orderId: string): Promise<string> {
  if (!env.testCheckoutAllowed) return "not_available";
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!row) return "unknown_song_order";
  return markPaid(row, { paymentRef: `test_${row.id}`, paymentIntentId: null, amountCents: env.freeDownloads ? 0 : (row.amountCents ?? (await getSongPrice()).cents), currency: row.currency ?? (await getSongPrice()).currency });
}

export type WebhookOutcome = { status: number; result: string };

/** Stripe webhooks. The signature is checked over the raw body; each event is processed once. */
export async function handleStripeWebhook(rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  const event = verifyEvent(rawBody, headers.get("stripe-signature"));
  if (!event) return { status: 400, result: "invalid_signature" };
  const db = await getDb();
  const inserted = await db.insert(webhookReceipts).values({ id: `stripe:${event.id}`, source: "stripe", topic: event.type }).onConflictDoNothing().returning();
  if (!inserted.length) return { status: 200, result: "duplicate_delivery" };
  try {
    switch (event.type) {
      // Fulfilment: card, Link and wallets complete as paid; delayed methods follow with async_payment_succeeded.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return { status: 200, result: await applyCompletedSession(event.data.object) };
      case "checkout.session.async_payment_failed": {
        const cs = event.data.object;
        const [row] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, cs.id)).limit(1);
        if (row) await logEvent(row.requestId, "order:payment_failed", { orderId: row.id, reason: "async_payment_failed" });
        return { status: 200, result: "payment_failed_logged" };
      }
      // Orders started before Checkout Sessions.
      case "payment_intent.succeeded":
        return { status: 200, result: await applySucceededIntent(event.data.object) };
      case "payment_intent.canceled":
        return { status: 200, result: await cancelPending(event.data.object.id) };
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        // Checkout Session orders only learn their PaymentIntent once paid, so match on our order id too.
        const orderId = pi.metadata?.order_id;
        const match = orderId && /^[0-9a-f-]{36}$/i.test(orderId) ? eq(orders.id, orderId) : eq(orders.stripePaymentIntentId, pi.id);
        const [row] = await db.select().from(orders).where(match).limit(1);
        if (row) await logEvent(row.requestId, "order:payment_failed", { orderId: row.id, reason: pi.last_payment_error?.code ?? "unknown" });
        return { status: 200, result: "payment_failed_logged" };
      }
      case "charge.refunded": {
        const charge = event.data.object;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        return { status: 200, result: piId && charge.refunded ? await processRefund(piId) : "partial_or_unknown_refund" };
      }
      // The price was changed in the Dashboard: show and sell the new one right away.
      case "product.updated":
      case "price.created":
      case "price.updated":
      case "price.deleted":
        invalidateSongPrice();
        return { status: 200, result: "price_refreshed" };
      default:
        return { status: 200, result: "ignored_event" };
    }
  } catch (e) {
    // Let Stripe retry: forget the receipt so the retry is processed.
    await db.delete(webhookReceipts).where(eq(webhookReceipts.id, `stripe:${event.id}`));
    reportError(e, { where: "stripe_webhook", eventType: event.type, eventId: event.id });
    return { status: 500, result: "error" };
  }
}

/** Make sure the full song is durably stored, then unlock it. Idempotent. */
export async function fulfil(order: Order): Promise<string> {
  const db = await getDb();
  const storage = await getStorage();
  const [v] = await db.select().from(songVersions).where(eq(songVersions.id, order.versionId)).limit(1);
  if (!v) return "missing_version";
  if (!v.audioKey || !(await storage.exists(v.audioKey))) {
    // Recover from the provider while its URL is still valid (Kie.ai keeps files ~14 days).
    try {
      if (!v.sourceAudioUrl) throw new Error("no source URL");
      assertSafeAudioUrl(v.sourceAudioUrl);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fulfil-"));
      const raw = path.join(tmp, "raw.audio");
      const full = path.join(tmp, "full.mp3");
      await downloadToFile(v.sourceAudioUrl, raw);
      await normalizeToMp3(raw, full);
      const key = v.audioKey ?? `requests/${v.requestId}/versions/${v.id}/full.mp3`;
      await storage.putFile(key, full, "audio/mpeg");
      await db.update(songVersions).set({ audioKey: key }).where(eq(songVersions.id, v.id));
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      await db.update(orders).set({ status: "paid_unfulfilled", error: `Audio unavailable: ${(e as Error).message}` }).where(eq(orders.id, order.id));
      await logEvent(order.requestId, "order:unfulfilled", { orderId: order.id, error: (e as Error).message });
      reportIssue("Paid order could not be delivered", { kind: "paid_unfulfilled", orderId: order.id, requestId: order.requestId, error: (e as Error).message }, "fatal");
      return "paid_unfulfilled";
    }
  }
  await db.update(songVersions).set({ purchaseStatus: "paid", selected: true }).where(eq(songVersions.id, v.id));
  await db.update(orders).set({ fulfilledAt: new Date(), status: "paid" }).where(eq(orders.id, order.id));
  await setStatus(order.requestId, "purchased", { selectedVersionId: v.id });
  await logEvent(order.requestId, "order:fulfilled", { orderId: order.id, versionId: v.id });
  await sendPurchaseEmail(order.id);
  return "fulfilled";
}

async function processRefund(paymentIntentId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, paymentIntentId)).limit(1);
  if (!row) return "unknown_order";
  if (row.status === "refunded") return "already_refunded";
  await db.update(orders).set({ status: "refunded", refundedAt: new Date() }).where(eq(orders.id, row.id));
  const [stillPaid] = await db.select().from(orders).where(and(eq(orders.versionId, row.versionId), eq(orders.status, "paid"))).limit(1);
  if (!stillPaid) await db.update(songVersions).set({ purchaseStatus: "refunded" }).where(eq(songVersions.id, row.versionId));
  await logEvent(row.requestId, "order:refunded", { orderId: row.id });
  return "refunded";
}

async function cancelPending(paymentIntentId: string): Promise<string> {
  const db = await getDb();
  const done = await db.update(orders).set({ status: "cancelled" }).where(and(eq(orders.stripePaymentIntentId, paymentIntentId), eq(orders.status, "pending"))).returning();
  return done.length ? "cancelled" : "not_pending";
}

export async function getOrderForRequest(requestId: string) {
  const db = await getDb();
  return db.select().from(orders).where(eq(orders.requestId, requestId)).orderBy(desc(orders.createdAt));
}

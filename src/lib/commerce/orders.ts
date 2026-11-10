/**
 * Orders: from "Get the full song" to a verified, fulfilled purchase.
 *
 * - The server decides which version is being bought; the client only names a
 *   version id, which must belong to the caller's project and be on offer.
 * - Nothing is unlocked by a browser redirect. Only a verified Shopify webhook
 *   (HMAC over the raw body) marks an order paid.
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
import { createCart, verifyShopifyHmac, webhookSecret, songOrderIdFrom, containsSongVariant, fetchOrder, type ShopifyOrder } from "./shopify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { orders, songVersions, songRequests, webhookReceipts } = schema;

export type CheckoutResult = { ok: true; checkoutUrl: string; orderId: string; reused: boolean } | { ok: false; error: string; status: number };

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
  if (existing?.checkoutUrl) {
    await logEvent(requestId, "checkout:reused", { orderId: existing.id, versionId });
    return { ok: true, checkoutUrl: existing.checkoutUrl, orderId: existing.id, reused: true };
  }

  const [order] = await db.insert(orders).values({ requestId, versionId, status: "pending", offerId: env.mockShopify ? "mock-song-offer" : env.shopify.songVariantId }).returning();
  try {
    const cart = await createCart(order.id, requestId);
    await db.update(orders).set({ cartId: cart.cartId, checkoutUrl: cart.checkoutUrl }).where(eq(orders.id, order.id));
    await db.update(songVersions).set({ purchaseStatus: "pending" }).where(and(eq(songVersions.id, versionId), ne(songVersions.purchaseStatus, "paid")));
    await logEvent(requestId, "checkout:started", { orderId: order.id, versionId, mock: env.mockShopify });
    return { ok: true, checkoutUrl: cart.checkoutUrl, orderId: order.id, reused: false };
  } catch (e) {
    await db.update(orders).set({ status: "cancelled", error: (e as Error).message }).where(eq(orders.id, order.id));
    return { ok: false, error: "Checkout is unavailable right now. Please try again.", status: 502 };
  }
}

export type WebhookOutcome = { status: number; result: string };

/** Entry point for Shopify webhooks (and the mock checkout, which signs its payload the same way). */
export async function handleShopifyWebhook(rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  if (!verifyShopifyHmac(rawBody, headers.get("x-shopify-hmac-sha256"), webhookSecret())) return { status: 401, result: "invalid_signature" };
  const topic = headers.get("x-shopify-topic") ?? "";
  const eventId = headers.get("x-shopify-event-id") ?? headers.get("x-shopify-webhook-id");
  const db = await getDb();
  if (eventId) {
    const inserted = await db.insert(webhookReceipts).values({ id: `shopify:${eventId}`, source: "shopify", topic }).onConflictDoNothing().returning();
    if (!inserted.length) return { status: 200, result: "duplicate_delivery" };
  }
  let payload: ShopifyOrder & { order_id?: number | string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, result: "bad_json" };
  }
  try {
    if (topic === "orders/paid") return { status: 200, result: await processPaidOrder(payload) };
    if (topic === "refunds/create") return { status: 200, result: await processRefund(payload) };
    if (topic === "orders/cancelled") return { status: 200, result: await processCancelled(payload) };
    return { status: 200, result: "ignored_topic" };
  } catch (e) {
    // Let Shopify retry: forget the receipt so the retry is processed.
    if (eventId) await db.delete(webhookReceipts).where(eq(webhookReceipts.id, `shopify:${eventId}`));
    console.error("[shopify] webhook processing failed", e);
    return { status: 500, result: "error" };
  }
}

async function processPaidOrder(webhookOrder: ShopifyOrder): Promise<string> {
  // Prefer the authoritative Admin API view when available.
  const order = (await fetchOrder(webhookOrder.id)) ?? webhookOrder;
  const songOrderId = songOrderIdFrom(order);
  if (!songOrderId || !/^[0-9a-f-]{36}$/i.test(songOrderId)) return "not_a_song_order";
  if (order.financial_status !== "paid") return `not_paid:${order.financial_status}`;
  if (!containsSongVariant(order)) return "wrong_product";

  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, songOrderId)).limit(1);
  if (!row) return "unknown_song_order";
  const shopifyOrderId = String(order.id);
  const amountCents = Math.round(Number(order.total_price ?? 0) * 100);

  if (row.status === "paid" || row.status === "paid_unfulfilled") {
    if (row.shopifyOrderId === shopifyOrderId) return "already_paid";
    // Same song order paid twice through two Shopify orders: never fulfil twice, flag for refund.
    await db.insert(orders).values({ requestId: row.requestId, versionId: row.versionId, status: "duplicate_payment", shopifyOrderId, amountCents, currency: order.currency ?? null, error: `Duplicate payment for song order ${row.id}` }).onConflictDoNothing();
    await logEvent(row.requestId, "order:duplicate_payment", { orderId: row.id, shopifyOrderId });
    return "duplicate_payment";
  }

  // A different order already paid for the same version (two checkouts, both paid).
  const [otherPaid] = await db.select().from(orders).where(and(eq(orders.versionId, row.versionId), eq(orders.status, "paid"), ne(orders.id, row.id))).limit(1);
  const newStatus = otherPaid ? "duplicate_payment" : "paid";
  const claimed = await db
    .update(orders)
    .set({ status: newStatus, shopifyOrderId, amountCents, currency: order.currency ?? null, paidAt: new Date(), error: otherPaid ? `Version already paid by order ${otherPaid.id}` : null })
    .where(and(eq(orders.id, row.id), eq(orders.status, "pending")))
    .returning();
  if (!claimed.length) return "already_processed";
  await logEvent(row.requestId, newStatus === "paid" ? "order:paid" : "order:duplicate_payment", { orderId: row.id, shopifyOrderId, amountCents });
  if (newStatus !== "paid") return "duplicate_payment";
  return fulfil(claimed[0]);
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
      return "paid_unfulfilled";
    }
  }
  await db.update(songVersions).set({ purchaseStatus: "paid", selected: true }).where(eq(songVersions.id, v.id));
  await db.update(orders).set({ fulfilledAt: new Date(), status: "paid" }).where(eq(orders.id, order.id));
  await setStatus(order.requestId, "purchased", { selectedVersionId: v.id });
  await logEvent(order.requestId, "order:fulfilled", { orderId: order.id, versionId: v.id });
  return "fulfilled";
}

async function processRefund(payload: { order_id?: number | string }): Promise<string> {
  if (!payload.order_id) return "no_order_id";
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.shopifyOrderId, String(payload.order_id))).limit(1);
  if (!row) return "unknown_order";
  if (row.status === "refunded") return "already_refunded";
  await db.update(orders).set({ status: "refunded", refundedAt: new Date() }).where(eq(orders.id, row.id));
  const [stillPaid] = await db.select().from(orders).where(and(eq(orders.versionId, row.versionId), eq(orders.status, "paid"))).limit(1);
  if (!stillPaid) await db.update(songVersions).set({ purchaseStatus: "refunded" }).where(eq(songVersions.id, row.versionId));
  await logEvent(row.requestId, "order:refunded", { orderId: row.id });
  return "refunded";
}

async function processCancelled(order: ShopifyOrder): Promise<string> {
  const songOrderId = songOrderIdFrom(order);
  if (!songOrderId) return "not_a_song_order";
  const db = await getDb();
  const done = await db.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, songOrderId), eq(orders.status, "pending"))).returning();
  return done.length ? "cancelled" : "not_pending";
}

/** Build the exact payload Shopify would send for a paid order. Mock checkout only. */
export function mockPaidOrderPayload(orderId: string, versionId: string): ShopifyOrder {
  return {
    id: Number(`9${Date.now()}`.slice(0, 13)),
    financial_status: "paid",
    total_price: "39.00",
    currency: "USD",
    cancelled_at: null,
    line_items: [{ variant_id: 1, quantity: 1, price: "39.00", properties: [{ name: "_song_order_id", value: orderId }, { name: "_version", value: versionId }] }],
    note_attributes: [{ name: "_song_order_id", value: orderId }],
  };
}

export async function getOrderForRequest(requestId: string) {
  const db = await getDb();
  return db.select().from(orders).where(eq(orders.requestId, requestId)).orderBy(desc(orders.createdAt));
}

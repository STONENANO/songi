import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { handleShopifyWebhook, mockPaidOrderPayload } from "@/lib/commerce/orders";
import { signShopifyBody } from "@/lib/commerce/shopify";
import { requireProject } from "@/lib/http/guard";

export const runtime = "nodejs";

/**
 * Mock checkout only (no Shopify credentials, not production). Builds the
 * payload Shopify would send and runs it through the real webhook handler,
 * including HMAC verification and de-duplication.
 */
export async function POST(req: Request) {
  if (!env.testCheckoutAllowed) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const parsed = z.object({ orderId: z.string().uuid(), deliveries: z.number().int().min(1).max(3).optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, parsed.data.orderId)).limit(1);
  if (!order) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
  const g = await requireProject(req, order.requestId);
  if (g instanceof NextResponse) return g;

  const raw = JSON.stringify(mockPaidOrderPayload(order.id, order.versionId));
  const eventId = `mock-${order.id}`;
  const results: string[] = [];
  // deliveries > 1 simulates Shopify retrying the same webhook.
  for (let i = 0; i < (parsed.data.deliveries ?? 1); i++) {
    const headers = new Headers({ "x-shopify-hmac-sha256": signShopifyBody(raw, env.mockShopifyWebhookSecret), "x-shopify-topic": "orders/paid", "x-shopify-event-id": eventId });
    results.push((await handleShopifyWebhook(raw, headers)).result);
  }
  return NextResponse.json({ results });
}

import { NextResponse } from "next/server";
import { handleShopifyWebhook } from "@/lib/commerce/orders";

export const runtime = "nodejs";

/** Shopify webhooks (orders/paid, refunds/create, orders/cancelled). HMAC is checked over the raw body. */
export async function POST(req: Request) {
  const raw = await req.text();
  const out = await handleShopifyWebhook(raw, req.headers);
  return NextResponse.json({ result: out.result }, { status: out.status });
}

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { payWithTestCheckout } from "@/lib/commerce/orders";
import { requireProject } from "@/lib/http/guard";
import { readJson, BODY_LIMITS } from "@/lib/http/body";

export const runtime = "nodejs";

/**
 * Test checkout only (no Stripe keys, or free-download mode on a live test server).
 * Pays the order through the same claim and fulfilment path a real payment uses.
 */
export async function POST(req: Request) {
  if (!env.testCheckoutAllowed) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const body = await readJson(req, BODY_LIMITS.small);
  if (!body.ok) return body.response;
  const parsed = z.object({ orderId: z.string().uuid() }).safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, parsed.data.orderId)).limit(1);
  if (!order) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
  const g = await requireProject(req, order.requestId);
  if (g instanceof NextResponse) return g;
  return NextResponse.json({ result: await payWithTestCheckout(order.id) });
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import MockPay from "./mock-pay";

export const dynamic = "force-dynamic";

export default async function MockCheckout({ params }: { params: Promise<{ orderId: string }> }) {
  if (!env.mockShopify || env.isProd) notFound();
  const { orderId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) notFound();
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.id, order.versionId)).limit(1);
  return (
    <div>
      <div className="banner">Test checkout. No card is charged. In production this step is Shopify's checkout.</div>
      <h1>Checkout</h1>
      <div className="card">
        <p style={{ margin: 0 }}>
          <b>{v?.title ?? "Your song"}</b>
          {v?.variantLabel ? <> · {v.variantLabel}</> : null}
        </p>
        <p className="muted">Full song, lyrics and download link. {env.shopify.priceLabel}</p>
        <MockPay orderId={order.id} requestId={order.requestId} alreadyPaid={order.status !== "pending"} />
      </div>
    </div>
  );
}

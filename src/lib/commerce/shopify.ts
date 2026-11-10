/**
 * Shopify integration: Storefront cart creation for checkout, and webhook
 * verification. Price is always Shopify's; the app never sends or trusts one.
 *
 * Mock mode (no Shopify credentials): checkout goes to a local test page that
 * posts a webhook signed with a mock secret through the same verification path.
 */
import crypto from "node:crypto";
import { env } from "../env";

export const ORDER_ATTRIBUTE = "_song_order_id";

export function webhookSecret(): string {
  return env.mockShopify ? env.mockShopifyWebhookSecret : env.shopify.webhookSecret;
}

/** Shopify signs the raw body: base64(HMAC-SHA256(rawBody, clientSecret)) in X-Shopify-Hmac-SHA256. */
export function verifyShopifyHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signShopifyBody(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

/** Numeric id from a Shopify GID ("gid://shopify/ProductVariant/123" -> "123"). */
export function numericId(gid: string): string {
  return gid.split("/").pop()?.split("?")[0] ?? gid;
}

export type CartResult = { cartId: string; checkoutUrl: string };

export async function createCart(orderId: string, projectId: string): Promise<CartResult> {
  if (env.mockShopify) {
    return { cartId: `mock-cart-${orderId}`, checkoutUrl: `${env.appUrl}/checkout/mock/${orderId}` };
  }
  const s = env.shopify;
  const query = `mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) { cart { id checkoutUrl } userErrors { field message } }
  }`;
  const variables = {
    input: {
      lines: [{ merchandiseId: s.songVariantId, quantity: 1, attributes: [{ key: ORDER_ATTRIBUTE, value: orderId }] }],
      attributes: [
        { key: ORDER_ATTRIBUTE, value: orderId },
        { key: "_song_project_id", value: projectId },
      ],
    },
  };
  const res = await fetch(`https://${s.storeDomain}/api/${s.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": s.storefrontToken },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: { cartCreate?: { cart?: { id: string; checkoutUrl: string }; userErrors?: { message: string }[] } }; errors?: { message: string }[] } | null;
  const cart = json?.data?.cartCreate?.cart;
  const errs = [...(json?.errors ?? []), ...(json?.data?.cartCreate?.userErrors ?? [])].map((e) => e.message);
  if (!res.ok || !cart) throw new Error(`Shopify cart creation failed: ${errs.join("; ") || `HTTP ${res.status}`}`);
  // The cart id includes a secret key; it is stored server-side only and never sent to the browser.
  return { cartId: cart.id, checkoutUrl: cart.checkoutUrl };
}

export type ShopifyOrder = {
  id: number | string;
  financial_status?: string;
  total_price?: string;
  currency?: string;
  cancelled_at?: string | null;
  line_items?: { variant_id?: number | string | null; quantity?: number; price?: string; properties?: { name: string; value: string }[] }[];
  note_attributes?: { name: string; value: string }[];
};

/** Authoritative order lookup via the Admin API, when an admin token is configured. */
export async function fetchOrder(orderId: string | number): Promise<ShopifyOrder | null> {
  const s = env.shopify;
  if (env.mockShopify || !s.adminToken) return null;
  const res = await fetch(`https://${s.storeDomain}/admin/api/${s.apiVersion}/orders/${orderId}.json?fields=id,financial_status,total_price,currency,cancelled_at,line_items,note_attributes`, {
    headers: { "X-Shopify-Access-Token": s.adminToken },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { order?: ShopifyOrder };
  return j.order ?? null;
}

/** Find our order id on a Shopify order (line item property first, then order attribute). */
export function songOrderIdFrom(order: ShopifyOrder): string | null {
  for (const li of order.line_items ?? []) {
    const p = li.properties?.find((x) => x.name === ORDER_ATTRIBUTE);
    if (p?.value) return p.value;
  }
  return order.note_attributes?.find((x) => x.name === ORDER_ATTRIBUTE)?.value ?? null;
}

/** The order must contain the configured song product. */
export function containsSongVariant(order: ShopifyOrder): boolean {
  if (env.mockShopify) return (order.line_items ?? []).length > 0;
  const want = numericId(env.shopify.songVariantId);
  return (order.line_items ?? []).some((li) => String(li.variant_id ?? "") === want && (li.quantity ?? 0) >= 1);
}

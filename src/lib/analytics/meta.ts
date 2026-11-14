/**
 * Meta Conversions API: tells Meta, from our server, when someone starts a song, opens
 * checkout, or pays. Server events can't be blocked by ad blockers or lost when a tab
 * closes, and they carry the buyer's hashed email so Meta can match them to the ad click.
 *
 * Each event uses the same event_id as the browser Pixel's (lead:/checkout:/purchase: + id),
 * so Meta counts it once. Free test unlocks are never sent as purchases.
 * Off without META_PIXEL_ID and META_CAPI_TOKEN. Never throws.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAttribution } from "../db/schema";
import { env } from "../env";
import { metaEventId } from "./meta-ids";

export type MetaEventName = "Lead" | "InitiateCheckout" | "Purchase";

export { metaEventId };

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Meta's user_data: email and our song id hashed (lowercase, trimmed), browser IDs as they are. */
export function metaUserData(o: { email?: string | null; externalId?: string | null; attribution?: AdAttribution | null }): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  const email = o.email?.trim().toLowerCase();
  if (email) u.em = [sha256(email)];
  if (o.externalId) u.external_id = [sha256(o.externalId)];
  const a = o.attribution ?? {};
  if (a.fbp) u.fbp = a.fbp;
  if (a.fbc) u.fbc = a.fbc;
  if (a.ip) u.client_ip_address = a.ip;
  if (a.ua) u.client_user_agent = a.ua;
  return u;
}

/** Our event log -> a Meta event, or null when Meta shouldn't hear about it. */
export function metaEventFor(type: string, payload: Record<string, unknown>): { name: MetaEventName; eventId: string; customData: Record<string, unknown> } | null {
  const orderId = typeof payload.orderId === "string" ? payload.orderId : "";
  if (type === "checkout:started" && orderId) {
    return { name: "InitiateCheckout", eventId: metaEventId.checkout(orderId), customData: { content_type: "product", content_ids: ["song"], num_items: 1 } };
  }
  if (type === "order:paid" && orderId) {
    const amount = Number(payload.amountCents ?? 0) - Number(payload.taxCents ?? 0);
    // Not a sale: our test checkout (free unlocks, the test button: test_ payment), no money,
    // or Stripe in test mode (test card payments).
    if (String(payload.paymentRef ?? "").startsWith("test_") || amount <= 0 || env.stripeTestMode) return null;
    return {
      name: "Purchase",
      eventId: metaEventId.purchase(orderId),
      customData: { value: amount / 100, currency: String(payload.currency ?? env.currency).toUpperCase(), content_type: "product", content_ids: ["song"], num_items: 1 },
    };
  }
  return null;
}

export async function sendMetaEvent(
  requestId: string,
  e: { name: MetaEventName; eventId: string; customData?: Record<string, unknown> },
): Promise<void> {
  if (!env.metaPixelId || !env.metaCapiToken) return;
  try {
    const db = await getDb();
    const [r] = await db
      .select({ email: schema.songRequests.email, attribution: schema.songRequests.adAttribution })
      .from(schema.songRequests)
      .where(eq(schema.songRequests.id, requestId))
      .limit(1);
    if (!r) return;
    const body: Record<string, unknown> = {
      data: [
        {
          event_name: e.name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: e.eventId,
          action_source: "website",
          event_source_url: `${env.appUrl}/create`,
          user_data: metaUserData({ email: r.email, externalId: requestId, attribution: r.attribution }),
          custom_data: e.customData ?? {},
        },
      ],
      access_token: env.metaCapiToken,
    };
    if (env.metaTestEventCode) body.test_event_code = env.metaTestEventCode;
    const res = await fetch(`${env.metaGraphUrl}/${encodeURIComponent(env.metaPixelId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      console.warn(`[meta] ${e.name} not accepted (${res.status}):`, err?.error?.message ?? "no details");
    }
  } catch (err) {
    console.warn(`[meta] ${e.name} not sent:`, err instanceof Error ? err.message : err);
  }
}

/** Called by logEvent for every event; sends the ones Meta should hear about. */
export async function forwardToMeta(requestId: string | null, type: string, payload: Record<string, unknown>): Promise<void> {
  if (!requestId || !env.metaPixelId || !env.metaCapiToken) return;
  const e = metaEventFor(type, payload);
  if (e) await sendMetaEvent(requestId, e);
}

/** What the browser told us when the song was started: Meta's cookies, its IP and user agent. */
export function attributionFrom(req: Request, ip: string): AdAttribution | null {
  const cookies = Object.fromEntries(
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  );
  const a: AdAttribution = {};
  if (/^fb\.\d\.\d+\.[\w.-]+$/.test(cookies._fbp ?? "")) a.fbp = cookies._fbp;
  if (/^fb\.\d\.\d+\.[\w.-]+$/.test(cookies._fbc ?? "")) a.fbc = cookies._fbc;
  if (ip && ip !== "local") a.ip = ip;
  const ua = req.headers.get("user-agent");
  if (ua) a.ua = ua.slice(0, 500);
  return Object.keys(a).length ? a : null;
}

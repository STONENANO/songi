/**
 * Forwards key server events to PostHog, so funnels run from the first quiz screen to a
 * paid order. The server sends these (not the browser), so ad blockers can't drop them and
 * "paid" is counted even when the buyer closes the tab before the success page.
 *
 * Events are joined to the visitor through the PostHog id the quiz sent with the song
 * (song_requests.posthog_id). Off when NEXT_PUBLIC_POSTHOG_KEY is empty. Never throws.
 */
import { eq } from "drizzle-orm";
import { PostHog } from "posthog-node";
import { getDb, schema } from "../db";
import { env } from "../env";

/** Events from logEvent() that are sent to PostHog. Everything else stays in our own events table. */
const FORWARDED = new Set([
  "status:needs_input",
  "status:preview_ready",
  "status:failed",
  "preview_play",
  "preview_complete",
  "candidate:selected",
  "checkout:started",
  "checkout:reused",
  "order:paid",
  "order:payment_failed",
  "order:duplicate_payment",
  "order:refunded",
]);

let client: PostHog | null = null;

function posthog(): PostHog | null {
  if (!env.posthogKey) return null;
  client ??= new PostHog(env.posthogKey, { host: env.posthogHost, flushAt: 10, flushInterval: 3000 });
  return client;
}

export function forwardsEvent(type: string): boolean {
  return FORWARDED.has(type) && !!env.posthogKey;
}

/** Send one of our events to PostHog. Fire and forget: analytics must never break the pipeline. */
export async function forwardEvent(requestId: string | null, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  if (!requestId || !forwardsEvent(type)) return;
  try {
    const ph = posthog();
    if (!ph) return;
    const db = await getDb();
    const [r] = await db
      .select({ posthogId: schema.songRequests.posthogId, occasion: schema.songRequests.occasion, relationship: schema.songRequests.relationship, genre: schema.songRequests.genreKey })
      .from(schema.songRequests)
      .where(eq(schema.songRequests.id, requestId))
      .limit(1);
    const properties: Record<string, unknown> = {
      ...payload,
      request_id: requestId,
      occasion: r?.occasion,
      relationship: r?.relationship,
      genre: r?.genre,
      source: "server",
    };
    // Revenue before tax, in currency units, for PostHog revenue charts.
    if (type === "order:paid") properties.revenue = (Number(payload.amountCents ?? 0) - Number(payload.taxCents ?? 0)) / 100;
    // Without the visitor's id (old songs, or PostHog blocked in their browser) the event still
    // counts, under the song's own id, but it can't join that visitor's funnel.
    const distinctId = r?.posthogId || `song:${requestId}`;
    if (!r?.posthogId) properties.$process_person_profile = false;
    ph.capture({ distinctId, event: type, properties });
  } catch (e) {
    console.warn("[posthog] dropped event", type, e instanceof Error ? e.message : e);
  }
}

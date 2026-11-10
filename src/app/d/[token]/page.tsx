import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { verifyDeliveryToken, issueMediaToken, mediaUrl } from "@/lib/media/tokens";
import { normalizeBrief } from "@/lib/songcraft";

export const dynamic = "force-dynamic";

/** Permanent delivery link for a paid order. Download URLs inside are short-lived and re-issued on each visit. */
export default async function Delivery({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const orderId = verifyDeliveryToken(decodeURIComponent(token));
  if (!orderId) notFound();
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order || order.status !== "paid" || !order.fulfilledAt) notFound();
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.id, order.versionId)).limit(1);
  const [r] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.id, order.requestId)).limit(1);
  if (!v?.audioKey || !r) notFound();
  const [draft] = await db.select().from(schema.generations).where(eq(schema.generations.id, v.generationId)).limit(1);
  const [lyrics] = draft ? await db.select().from(schema.lyricDrafts).where(eq(schema.lyricDrafts.id, draft.lyricDraftId)).limit(1) : [];
  const brief = normalizeBrief(r.brief);
  const filename = `${(v.title ?? "song").replace(/[^\w\- ]+/g, "").trim() || "song"}.mp3`;
  const listen = mediaUrl(issueMediaToken({ key: v.audioKey, kind: "full", ttlSec: env.downloadUrlTtlSec, versionId: v.id, filename }));
  return (
    <div>
      <p className="muted" style={{ margin: 0 }}>A song for {brief?.recipient.name || r.recipientName || "someone special"}</p>
      <h1>{v.title ?? "Your song"}</h1>
      <div className="card">
        <audio controls preload="metadata" src={listen} />
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn" href={listen} download={filename} style={{ textDecoration: "none" }}>
            Download MP3
          </a>
          <span className="muted" style={{ fontSize: 13 }}>Keep this page's link to download again any time.</span>
        </div>
      </div>
      {lyrics && (
        <div className="card">
          <div className="lyrics">{lyrics.displayLyrics}</div>
        </div>
      )}
    </div>
  );
}

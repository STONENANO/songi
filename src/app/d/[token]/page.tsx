import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { verifyDeliveryToken, issueMediaToken, mediaUrl } from "@/lib/media/tokens";
import { normalizeBrief, getGenre } from "@/lib/songcraft";
import { AudioPlayer, Button, Card, Lyrics, Note, Screen, ScreenTitle, TrustRow } from "@/components/ui";
import { buildLyricSections, type StoryLine } from "@/lib/onboarding/lyrics-view";

export const dynamic = "force-dynamic";

/**
 * Permanent delivery link for a paid order: what the buyer keeps, and what the
 * person receiving the gift may open. Download URLs inside are short-lived and
 * re-issued on each visit.
 */
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
  const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, v.generationId)).limit(1);
  const [lyrics] = gen ? await db.select().from(schema.lyricDrafts).where(eq(schema.lyricDrafts.id, gen.lyricDraftId)).limit(1) : [];
  const brief = normalizeBrief(r.brief);
  const name = brief?.recipient.name || r.recipientName || "someone special";
  const quiz = (r.quizSnapshot ?? {}) as Record<string, unknown>;
  const giver = (typeof quiz.giverName === "string" && quiz.giverName) || brief?.giverName || "";
  const title = v.title ?? `${name}'s Song`;
  const filename = `${title.replace(/[^\w\- ]+/g, "").trim() || "song"}.mp3`;
  const listen = mediaUrl(issueMediaToken({ key: v.audioKey, kind: "full", ttlSec: env.downloadUrlTtlSec, versionId: v.id, filename }));

  // Same story-line highlighting as the song page.
  const facts = new Map((brief?.facts ?? []).map((f) => [f.id, f]));
  const storyLines: StoryLine[] = (lyrics?.factPlacement ?? [])
    .map((p) => {
      const f = facts.get(p.factId);
      return f ? { line: p.line, fact: f.text, quote: f.sourceQuote ?? "" } : null;
    })
    .filter((x): x is StoryLine => !!x);
  const sections = lyrics ? buildLyricSections(lyrics.displayLyrics, storyLines) : [];

  return (
    <Screen>
      <ScreenTitle
        eyebrow={`A song for ${name}`}
        title={title}
        subtitle={`An original ${getGenre(r.genreKey).label} song written for ${name}${giver ? `, from ${giver}` : ""}.`}
      />
      <div className="ui-stack">
        <AudioPlayer src={listen} title="Full song" />
        <Button block href={listen} download>
          Download MP3
        </Button>
        <TrustRow items={["Yours to keep", "Play it anywhere", "Download again any time from this link"]} />
      </div>
      {sections.length > 0 && (
        <Card title="The lyrics">
          <Lyrics sections={sections} legend={storyLines.length ? "Highlighted lines came from the story. Tap one to see." : undefined} />
        </Card>
      )}
      <Card tone="muted" title="Keep this page">
        <Note>Bookmark it or save the link. It always plays and downloads {name}&apos;s song.</Note>
      </Card>
    </Screen>
  );
}

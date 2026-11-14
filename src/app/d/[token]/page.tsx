import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { issueMediaToken, mediaUrl } from "@/lib/media/tokens";
import { getGenre } from "@/lib/songcraft";
import { buildLyricSections, timeLyricLines, type StoryLine } from "@/lib/onboarding/lyrics-view";
import SongPlayer from "./player";
import { loadSong } from "./song-data";
import { MetaEvent } from "../../meta-pixel";
import { metaEventId } from "@/lib/analytics/meta-ids";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const song = await loadSong((await params).token);
  if (!song) return {};
  const description = `An original song written for ${song.name}${song.giver ? `, from ${song.giver}` : ""}. Press play.`;
  return {
    title: `${song.title} · a song for ${song.name}`,
    description,
    robots: { index: false, follow: false },
    openGraph: { title: song.title, description, type: "music.song" },
    twitter: { card: "summary_large_image", title: song.title, description },
  };
}

/**
 * The song's permanent page: what the buyer keeps and shares. A music player with the
 * lyrics following along. Audio links inside are short-lived and re-issued on each visit.
 */
export default async function Delivery({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const [{ token }, { new: isNew }] = await Promise.all([params, searchParams]);
  const song = await loadSong(token);
  if (!song) notFound();
  const { v, r, lyrics, brief, name, giver, title, order } = song;
  // Right after a real Stripe payment (not a free test unlock or a Stripe test-mode card): the browser half of Meta's Purchase.
  const paidCents = (order.amountCents ?? 0) - (order.taxCents ?? 0);
  const realPurchase = isNew === "1" && paidCents > 0 && !!(order.stripeCheckoutSessionId || order.stripePaymentIntentId) && !env.stripeTestMode;

  const filename = `${title.replace(/[^\w\- ]+/g, "").trim() || "song"}.mp3`;
  const listen = mediaUrl(issueMediaToken({ key: v.audioKey!, kind: "full", ttlSec: env.downloadUrlTtlSec, versionId: v.id }));
  const download = mediaUrl(issueMediaToken({ key: v.audioKey!, kind: "full", ttlSec: env.downloadUrlTtlSec, versionId: v.id, filename }));

  const facts = new Map((brief?.facts ?? []).map((f) => [f.id, f]));
  const storyLines: StoryLine[] = (lyrics?.factPlacement ?? [])
    .map((p) => {
      const f = facts.get(p.factId);
      return f ? { line: p.line, fact: f.text, quote: f.sourceQuote ?? "" } : null;
    })
    .filter((x): x is StoryLine => !!x);
  const sections = lyrics ? timeLyricLines(buildLyricSections(lyrics.displayLyrics, storyLines), v.alignedWords) : [];

  return (
    <>
      {realPurchase && (
        <MetaEvent
          name="Purchase"
          eventId={metaEventId.purchase(order.id)}
          params={{ value: paidCents / 100, currency: (order.currency ?? env.currency).toUpperCase(), content_type: "product", content_ids: ["song"], num_items: 1 }}
        />
      )}
      <SongPlayer
      title={title}
      byline={`For ${name}${giver ? ` · from ${giver}` : ""} · ${getGenre(r.genreKey).label}`}
      recipient={name}
      src={listen}
      downloadHref={download}
      sections={sections}
      welcome={isNew === "1"}
      durationS={v.duration}
      />
    </>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { verifyDeliveryToken, issueMediaToken, mediaUrl } from "@/lib/media/tokens";
import { normalizeBrief, getGenre } from "@/lib/songcraft";
import { buildLyricSections, timeLyricLines, type StoryLine } from "@/lib/onboarding/lyrics-view";
import SongPlayer from "./player";

export const dynamic = "force-dynamic";

/** Everything the song page needs, loaded once per request (page and metadata share it). */
const loadSong = cache(async (token: string) => {
  const orderId = verifyDeliveryToken(decodeURIComponent(token));
  if (!orderId) return null;
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order || order.status !== "paid" || !order.fulfilledAt) return null;
  const [v] = await db.select().from(schema.songVersions).where(eq(schema.songVersions.id, order.versionId)).limit(1);
  const [r] = await db.select().from(schema.songRequests).where(eq(schema.songRequests.id, order.requestId)).limit(1);
  if (!v?.audioKey || !r) return null;
  const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, v.generationId)).limit(1);
  const [lyrics] = gen ? await db.select().from(schema.lyricDrafts).where(eq(schema.lyricDrafts.id, gen.lyricDraftId)).limit(1) : [];
  const brief = normalizeBrief(r.brief);
  const name = brief?.recipient.name || r.recipientName || "someone special";
  const quiz = (r.quizSnapshot ?? {}) as Record<string, unknown>;
  const giver = (typeof quiz.giverName === "string" && quiz.giverName) || brief?.giverName || "";
  const title = v.title || `${name}'s Song`;
  // Our saved copy first; the provider's link only for songs made before covers were saved.
  const cover = v.coverKey ? `/api/cover/${encodeURIComponent(token)}` : v.imageUrl;
  return { order, v, r, lyrics, brief, name, giver, title, cover };
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const song = await loadSong((await params).token);
  if (!song) return {};
  const description = `An original song written for ${song.name}${song.giver ? `, from ${song.giver}` : ""}. Press play.`;
  // Link previews need an absolute image address; use the host this page was opened on.
  const h = await headers();
  const origin = h.get("host") ? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}` : env.appUrl;
  const images = song.cover ? [{ url: song.cover.startsWith("/") ? `${origin}${song.cover}` : song.cover, width: 512, height: 512 }] : undefined;
  return {
    title: `${song.title} · a song for ${song.name}`,
    description,
    robots: { index: false, follow: false },
    openGraph: { title: song.title, description, type: "music.song", images },
    twitter: { card: images ? "summary_large_image" : "summary", title: song.title, description },
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
  const { v, r, lyrics, brief, name, giver, title, cover } = song;

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
    <SongPlayer
      title={title}
      byline={`For ${name}${giver ? ` · from ${giver}` : ""} · ${getGenre(r.genreKey).label}`}
      recipient={name}
      coverUrl={cover ?? null}
      src={listen}
      downloadHref={download}
      sections={sections}
      welcome={isNew === "1"}
      durationS={v.duration}
    />
  );
}

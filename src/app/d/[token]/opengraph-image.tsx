/** The card shown when a buyer shares their song: "A song for Rasheda, from Jordan". */
import { shareCard, SHARE_IMAGE_SIZE } from "@/lib/share-card";
import { SHARE } from "@/lib/brand";
import { loadSong } from "./song-data";

export const runtime = "nodejs";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = "A custom song";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const song = await loadSong((await params).token);
  if (!song) return shareCard({ eyebrow: SHARE.eyebrow, title: SHARE.title, sub: "Hear it free first" });
  return shareCard({
    eyebrow: song.giver ? `From ${song.giver}, with love` : "Written from a true story",
    title: `A song for ${song.name}`,
    sub: "▶  Press play",
    mascot: "headphones",
  });
}

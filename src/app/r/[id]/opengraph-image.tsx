/**
 * The card for a shared preview link (/r/<id>?p=...). Deliberately generic: a crawler fetches
 * this image without the link's key, so it shows no names or story.
 */
import { shareCard, SHARE_IMAGE_SIZE } from "@/lib/share-card";

export const runtime = "nodejs";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = "A custom song, ready to hear";

export default function Image() {
  return shareCard({ eyebrow: "A custom song, written from a true story", title: "Pick your favourite version", sub: "▶  Listen now", mascot: "headphones" });
}

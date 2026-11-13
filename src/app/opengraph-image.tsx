/** The card shown when the home page (or any page without its own card) is shared. Text: SHARE in lib/brand.ts. */
import { shareCard, SHARE_IMAGE_SIZE } from "@/lib/share-card";
import { SHARE } from "@/lib/brand";

export const runtime = "nodejs";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";
export const alt = SHARE.title;

export default function Image() {
  return shareCard({ eyebrow: SHARE.eyebrow, title: SHARE.title, sub: "Hear it free first" });
}

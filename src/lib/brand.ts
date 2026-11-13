/** Placeholder brand. One place to change it once the name is decided. */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Cryworthy",
  /** Rough wall-clock seconds from lyrics approved to preview ready. Drives the wait-page progress bar. */
  estRecordSeconds: Number(process.env.NEXT_PUBLIC_EST_RECORD_SECONDS || 180),
  /** Optional wait-page video. Leave empty to show the built-in studio card instead. */
  waitVideoUrl: process.env.NEXT_PUBLIC_WAIT_VIDEO_URL || "",
};

/**
 * What a shared link says (iMessage, WhatsApp, Facebook, X, Slack...). Edit freely: the home
 * page card, the browser tab and search results use SHARE; a song link uses its own text,
 * built from the song (app/d/[token]).
 */
export const SHARE = {
  title: "Make them cry happy tears",
  description: "Tell us the little things only you know. We turn them into an original song about them, and you hear it free before you pay.",
  /** Small line above the title on the home page image. */
  eyebrow: "A custom song, written from your story",
};

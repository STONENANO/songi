/** Placeholder brand. One place to change it once the name is decided. */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Cryworthy",
  /** Rough wall-clock seconds from lyrics approved to preview ready. Drives the wait-page progress bar. */
  estRecordSeconds: Number(process.env.NEXT_PUBLIC_EST_RECORD_SECONDS || 180),
  /** Optional wait-page video. Leave empty to show the built-in studio card instead. */
  waitVideoUrl: process.env.NEXT_PUBLIC_WAIT_VIDEO_URL || "",
};

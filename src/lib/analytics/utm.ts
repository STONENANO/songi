/**
 * Which ad or link brought a visitor: the UTM tags on the URL they arrived with.
 *
 * Kept in the browser (localStorage, 30 days) from the landing page until they start a
 * song, then saved with it (song_requests.utm), so /admin/numbers can show sales by
 * campaign and ad. Two touches: the first ad that ever brought them, and the last one
 * before the song (the one shown in Numbers, matching Meta's last-click view).
 *
 * In Meta Ads Manager -> ad -> Tracking -> URL parameters:
 *   utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}
 */
import { z } from "zod/v4";

const KEYS = ["source", "medium", "campaign", "term", "content"] as const;
const MAX = 200;
const KEEP_DAYS = 30;
const STORAGE_KEY = "cw_utm";

export type UtmTouch = {
  source?: string;
  medium?: string;
  campaign?: string;
  /** Ad set name when Meta's recommended parameters are used. */
  term?: string;
  /** Ad name when Meta's recommended parameters are used. */
  content?: string;
  /** Path the visitor landed on, without the query. */
  landing?: string;
  /** The site they came from (host only), when the browser says. */
  referrer?: string;
  /** When this touch happened (ms since epoch). */
  at: number;
};
export type UtmAttribution = { first: UtmTouch; last: UtmTouch };

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX);
  return s || undefined;
};

/** The UTM tags on a URL, or null when it has none. */
export function touchFromUrl(href: string, referrer: string, now = Date.now()): UtmTouch | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const t: UtmTouch = { at: now };
  for (const k of KEYS) {
    const v = clean(url.searchParams.get(`utm_${k}`));
    if (v) t[k] = v;
  }
  if (!KEYS.some((k) => t[k])) return null;
  t.landing = clean(url.pathname);
  try {
    const ref = referrer ? new URL(referrer).host : "";
    if (ref && ref !== url.host) t.referrer = clean(ref);
  } catch {
    /* no usable referrer */
  }
  return t;
}

/** Combine a new touch with what's stored: the first touch stays, the last is replaced. Old entries expire. */
export function mergeTouch(stored: UtmAttribution | null, touch: UtmTouch | null, now = Date.now()): UtmAttribution | null {
  const fresh = stored && now - stored.last.at < KEEP_DAYS * 86_400_000 ? stored : null;
  if (!touch) return fresh;
  return { first: fresh?.first ?? touch, last: touch };
}

const TouchSchema = z.object({
  source: z.string().max(MAX).optional(),
  medium: z.string().max(MAX).optional(),
  campaign: z.string().max(MAX).optional(),
  term: z.string().max(MAX).optional(),
  content: z.string().max(MAX).optional(),
  landing: z.string().max(MAX).optional(),
  referrer: z.string().max(MAX).optional(),
  at: z.number().int().nonnegative(),
});
/** What the server accepts from the quiz (anything else is dropped, never an error). */
export const UtmSchema = z.object({ first: TouchSchema, last: TouchSchema });

/* ---------------- browser ---------------- */

function readStored(): UtmAttribution | null {
  try {
    const parsed = UtmSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Call on every full page load: remembers the UTM tags the visitor arrived with. */
export function captureUtm(): void {
  try {
    const merged = mergeTouch(readStored(), touchFromUrl(window.location.href, document.referrer));
    if (merged) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode or storage blocked: no attribution, nothing breaks */
  }
}

/** Sent with a new song. Undefined when the visitor didn't arrive from a tagged link (in the last 30 days). */
export function currentUtm(): UtmAttribution | undefined {
  return mergeTouch(readStored(), null) ?? undefined;
}

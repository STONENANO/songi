/**
 * Browser-side Meta Pixel. fbq() queues calls right away; Meta's script (fbevents.js) loads
 * only after the page has, so it never slows the first screen. Off on /admin and /dev, and
 * when the server passes no Pixel ID. Event ids match the server's Conversions API events
 * (see lib/analytics/meta.ts), so Meta counts each event once.
 */
type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; callMethod?: (...args: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let started = false;
/** Events from components that render before the Pixel starts (React runs page effects before the layout's). */
const early: unknown[][] = [];

export function startMetaPixel(pixelId: string): void {
  if (started || !pixelId || typeof window === "undefined" || /^\/(admin|dev)(\/|$)/.test(window.location.pathname)) return;
  started = true;
  if (!window.fbq) {
    // Meta's standard stub: calls wait in a queue until fbevents.js arrives.
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    } as Fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
  }
  window.fbq("init", pixelId);
  for (const args of early.splice(0)) window.fbq(...args);
  const load = () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  };
  if (document.readyState === "complete") load();
  else window.addEventListener("load", load, { once: true });
}

/** A standard Meta event. eventId must match the server's for the same event. */
export function metaTrack(event: "PageView" | "Lead" | "InitiateCheckout" | "Purchase", params: Record<string, unknown> = {}, eventId?: string): void {
  try {
    const args: unknown[] = eventId ? ["track", event, params, { eventID: eventId }] : ["track", event, params];
    if (started && window.fbq) window.fbq(...args);
    else if (early.length < 20) early.push(args);
  } catch {
    /* tracking must never break the page */
  }
}

/**
 * Browser-side PostHog. The library (~120 kB) is loaded only after the page has loaded, so it
 * never slows the first screen; events captured before then wait in a small queue.
 * Every helper is a no-op when PostHog is off, blocked or failed to load.
 */
import type { PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");

let ph: PostHog | null = null;
const queue: { event: string; properties: Record<string, unknown>; timestamp: Date }[] = [];

/** Load and start PostHog once the page has loaded. Called from instrumentation-client.ts. */
export function startAnalytics(): void {
  if (!KEY || /^\/(admin|dev)(\/|$)/.test(window.location.pathname)) return;
  const load = () =>
    import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(KEY, {
          // Through our own domain (see next.config.ts), so ad blockers drop fewer events.
          api_host: "/ingest",
          ui_host: HOST.replace(".i.posthog.com", ".posthog.com"),
          defaults: "2026-08-30",
          // Anonymous visitors don't create person profiles (cheaper); events still count in funnels.
          person_profiles: "identified_only",
          // Quiz answers are personal stories: replays never show what people type.
          session_recording: { maskAllInputs: true },
        });
        ph = posthog;
        for (const q of queue.splice(0)) posthog.capture(q.event, q.properties, { timestamp: q.timestamp });
      })
      .catch(() => {
        /* blocked or offline: analytics stays off */
      });
  if (document.readyState === "complete") void load();
  else window.addEventListener("load", () => void load(), { once: true });
}

export function captureEvent(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (ph) ph.capture(event, properties);
    else if (KEY && queue.length < 100) queue.push({ event, properties, timestamp: new Date() });
  } catch {
    /* analytics must never break the page */
  }
}

/** This visitor's PostHog id, sent with a new song so server events join the same funnel. */
export function posthogId(): string | undefined {
  try {
    return ph?.get_distinct_id();
  } catch {
    return undefined;
  }
}

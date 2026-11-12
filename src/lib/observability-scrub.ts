/**
 * What error reports must never carry, shared by the server and the browser (no Node imports).
 *
 * Some URLs are credentials: /d/<token> opens a paid song, /api/media/<token> streams audio,
 * ?token= opens /admin and ?k= claims a song. Request bodies hold customers' stories,
 * names and emails, and cookies hold song access tokens. All of it is removed before
 * an event leaves the process.
 */
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const SECRET_PATHS: [RegExp, string][] = [
  [/\/d\/[^/?#\s"']+/g, "/d/[token]"],
  [/\/api\/media\/[^/?#\s"']+/g, "/api/media/[token]"],
];

/** Remove secret path segments and every query string from a URL or a message. */
export function scrubUrl(url: string): string {
  let out = url;
  for (const [re, repl] of SECRET_PATHS) out = out.replace(re, repl);
  return out.replace(/\?[^#\s"']*/g, "");
}

export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) if (/cookie|authorization|signature|x-real-ip|forwarded/i.test(h)) delete event.request.headers[h];
    }
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  delete event.user;
  for (const b of event.breadcrumbs ?? []) {
    if (typeof b.data?.url === "string") b.data.url = scrubUrl(b.data.url);
    if (typeof b.data?.to === "string") b.data.to = scrubUrl(b.data.to);
    if (typeof b.data?.from === "string") b.data.from = scrubUrl(b.data.from);
    if (typeof b.message === "string") b.message = scrubUrl(b.message);
  }
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubUrl(ex.value);
  return event;
}

/** Settings shared by the server and browser SDKs. Nothing is sent without a DSN. */
export function sentryOptions(dsn: string | undefined, environment: string) {
  return {
    dsn: dsn || undefined,
    enabled: !!dsn,
    environment,
    // Errors only: no performance tracing, no session replay, no default PII.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  };
}

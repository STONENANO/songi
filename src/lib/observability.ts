/**
 * Error tracking (server). Every report also goes to the log, so nothing is lost when
 * Sentry isn't configured. Context is ids and short codes only: never story text,
 * names, emails, tokens or request bodies (see observability-scrub.ts).
 */
import * as Sentry from "@sentry/nextjs";

type Context = Record<string, string | number | boolean | null | undefined>;

/** An unexpected failure: an exception we caught and handled. */
export function reportError(error: unknown, context: Context = {}): void {
  console.error(`[error] ${context.where ?? "unknown"}:`, error instanceof Error ? error.message : error, context);
  if (Sentry.isInitialized()) Sentry.captureException(error, { extra: context, tags: tagsOf(context) });
}

/**
 * A business problem that needs a person, even though no exception was thrown:
 * a paid order we couldn't deliver, a payment for the wrong amount.
 */
export function reportIssue(message: string, context: Context = {}, level: "warning" | "error" | "fatal" = "error"): void {
  console[level === "warning" ? "warn" : "error"](`[issue] ${message}`, context);
  if (Sentry.isInitialized()) Sentry.captureMessage(message, { level, extra: context, tags: tagsOf(context) });
}

function tagsOf(context: Context): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const k of ["where", "kind"]) if (context[k] != null) tags[k] = String(context[k]);
  return tags;
}

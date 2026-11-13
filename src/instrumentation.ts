/**
 * Runs once when the server starts: error tracking first (so a failed startup check is
 * reported too), then the startup checks. Logs whether file storage works, so a wrong
 * bucket key shows up in the deploy logs instead of after a song has been paid for.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Compile-time constant: the edge build drops this branch and its Node-only imports.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Without a DSN Sentry isn't started at all (its instrumentation would only add log noise).
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      const { sentryOptions } = await import("./lib/observability-scrub");
      Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "development"));
    }
    const { initializePostHogLogCapture } = await import("./lib/posthog-logs");
    initializePostHogLogCapture();
    const { startupChecks } = await import("./instrumentation-node");
    await startupChecks();
  }
}

/** Errors thrown by route handlers and server components, with the route that threw. */
export const onRequestError = Sentry.captureRequestError;

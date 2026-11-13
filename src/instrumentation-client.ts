/**
 * Error tracking in the browser (quiz, song page, checkout). Off unless
 * NEXT_PUBLIC_SENTRY_DSN is set at build time. Reports are scrubbed of
 * delivery links, media tokens, query strings and form data before sending.
 */
import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { sentryOptions } from "./lib/observability-scrub";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (posthogToken && posthogHost) {
  posthog.init(posthogToken, {
    api_host: posthogHost,
    capture_exceptions: true,
    defaults: "2026-08-30",
    debug: process.env.NODE_ENV === "development",
  });
} else if (process.env.NODE_ENV === "development") {
  if (!posthogToken) console.error("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured");
  if (!posthogHost) console.error("NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured");
}

if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV === "production" ? "production" : "development"));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

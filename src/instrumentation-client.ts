/**
 * Browser startup.
 * - Error tracking (quiz, song page, checkout). Off unless NEXT_PUBLIC_SENTRY_DSN is set at
 *   build time. Reports are scrubbed of delivery links, media tokens, query strings and form data.
 * - PostHog (page views, quiz funnel events, session replay), loaded once the page has loaded.
 *   Off when NEXT_PUBLIC_POSTHOG_KEY is empty, and on /admin and /dev.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/observability-scrub";
import { startAnalytics } from "./lib/analytics/client";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV === "production" ? "production" : "development"));

startAnalytics();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

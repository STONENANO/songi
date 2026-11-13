/**
 * Error tracking in the browser (quiz, song page, checkout). Off unless
 * NEXT_PUBLIC_SENTRY_DSN is set at build time. Reports are scrubbed of
 * delivery links, media tokens, query strings and form data before sending.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/observability-scrub";

Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV === "production" ? "production" : "development"));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

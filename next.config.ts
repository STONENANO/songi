import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { securityHeaders } from "./src/lib/http/security-headers";

// PostHog through our own domain (/ingest), so ad blockers drop fewer analytics events.
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
const posthogAssets = posthogHost.replace(/^https:\/\/(\w+)\.i\.posthog\.com$/, "https://$1-assets.i.posthog.com");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "@aws-sdk/client-s3"],
  // Don't advertise the framework and version.
  poweredByHeader: false,
  experimental: {
    // Route handlers run brief extraction + lyric generation after responding.
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ dev: process.env.NODE_ENV !== "production", waitVideoUrl: process.env.NEXT_PUBLIC_WAIT_VIDEO_URL, sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN }) }];
  },
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${posthogAssets}/static/:path*` },
      { source: "/ingest/array/:path*", destination: `${posthogAssets}/array/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  // PostHog's API paths end in a slash; don't redirect them away.
  skipTrailingSlashRedirect: true,
};

/**
 * Sentry source-map upload. Only on when the build-time auth token and the org/project slug are
 * set (production builds), so local builds and forks that lack them are completely untouched.
 * It injects a debug id into every bundle and uploads the matching source map, so Sentry shows the
 * real file and line instead of a minified chunk. Matching is by debug id, not release, so it works
 * even though .git isn't in the Docker build context. The maps are deleted from the build output
 * after upload (the SDK default), so they are never served to browsers.
 */
const sentryUpload = !!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default sentryUpload
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      widenClientFileUpload: true,
    })
  : nextConfig;

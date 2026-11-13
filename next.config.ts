import type { NextConfig } from "next";
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

export default nextConfig;

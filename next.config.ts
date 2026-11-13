import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/http/security-headers";

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
};

export default nextConfig;

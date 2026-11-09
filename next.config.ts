import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "@aws-sdk/client-s3"],
  experimental: {
    // Route handlers run brief extraction + lyric generation after responding.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;

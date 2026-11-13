import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

// Read APP_URL when served, not at build time (the build doesn't know the public address).
export const dynamic = "force-dynamic";

/** Search engines: the public pages only. Songs, checkouts, admin and APIs stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/r/", "/d/", "/checkout/", "/dev/", "/ingest/"] },
    sitemap: `${env.appUrl}/sitemap.xml`,
  };
}

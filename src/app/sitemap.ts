import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number) => ({ url: `${env.appUrl}${path}`, changeFrequency: "weekly" as const, priority });
  return [page("/", 1), page("/create", 0.8), page("/terms", 0.2), page("/privacy", 0.2), page("/refunds", 0.2)];
}

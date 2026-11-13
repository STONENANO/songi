import type { Metadata } from "next";
import StoryQuiz from "./quiz";
import { GENRE_LIST } from "@/lib/songcraft/registry";
import { env } from "@/lib/env";

/**
 * Rendered per request so the Turnstile site key comes from the server's settings when the
 * page loads, not from the build. A NEXT_PUBLIC_ value is only written into client code at
 * build time, so a host that restarts without rebuilding after a settings change would ship
 * a page without the bot check while the server demands it.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Make a song", alternates: { canonical: "/create" } };

export default function CreatePage() {
  // Only when the server will also check tokens (both keys set), so page and server always agree.
  const t = env.turnstile;
  return <StoryQuiz genres={GENRE_LIST} turnstileSiteKey={t.enabled ? t.siteKey : ""} />;
}

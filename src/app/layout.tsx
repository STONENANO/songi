import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./globals.css";
import "../components/ui/ui.css";
import { BRAND, SHARE } from "@/lib/brand";
import { env } from "@/lib/env";
import { MetaPixel } from "./meta-pixel";
import { UtmCapture } from "./attribution";

/**
 * Defaults for every page: the browser tab, search results and shared-link previews.
 * Text lives in SHARE (lib/brand.ts); the image is app/opengraph-image.tsx. Pages override
 * what they need (a song link builds its own title and card).
 */
export async function generateMetadata(): Promise<Metadata> {
  const home = `${BRAND.name}: ${SHARE.title}`;
  return {
    // Absolute links for share images (crawlers need full URLs).
    metadataBase: new URL(env.appUrl),
    title: { default: home, template: `%s · ${BRAND.name}` },
    description: SHARE.description,
    applicationName: BRAND.name,
    openGraph: { type: "website", siteName: BRAND.name, title: home, description: SHARE.description, url: "/" },
    twitter: { card: "summary_large_image", title: home, description: SHARE.description },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#fff9f5" };

// Brand faces (see --font-* in theme.css). Each token keeps a system fallback if these don't load.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Inter+Tight:wght@500;600&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Instrument+Serif:ital@0;1&family=Kalam:wght@400;700&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>
        {children}
        <UtmCapture />
        {env.metaPixelId && <MetaPixel pixelId={env.metaPixelId} />}
      </body>
    </html>
  );
}

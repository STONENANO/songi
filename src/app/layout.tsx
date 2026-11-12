import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./globals.css";
import "../components/ui/ui.css";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: BRAND.name,
  description: "Description placeholder.",
};

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
      <body>{children}</body>
    </html>
  );
}

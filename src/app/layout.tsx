import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./globals.css";
import "../components/ui/ui.css";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND.name}: a song written from your story`,
  description: "Tell us about someone you love. We'll write and sing a song about them.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

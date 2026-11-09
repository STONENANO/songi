import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Custom Song Studio",
  description: "Turn a few memories into a personalised song.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}

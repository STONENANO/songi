import type { Metadata } from "next";
import "../legacy.css";

/** Admin pages stay out of search engines and link previews. */
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false, nocache: true } };

/** Internal and post-purchase pages keep the original dark styling. */
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="legacy">
      <div className="wrap">{children}</div>
    </div>
  );
}

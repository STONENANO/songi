import type { Metadata } from "next";

/** Admin pages stay out of search engines and link previews. */
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false, nocache: true } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}

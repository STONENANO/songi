import type { Metadata } from "next";
import { connection } from "next/server";
import { BRAND } from "@/lib/brand";
import { MascotLoop } from "@/components/ui";
import { SiteFooter } from "@/components/legal";
import "./not-found.css";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

/** Any unknown address, and links that no longer work (an old song or checkout link). */
export default async function NotFound() {
  // Rendered when served, not at build time, so the footer has the live settings (support email).
  await connection();
  return (
    <div className="nf">
      <header className="nf__bar">
        <a className="nf__brand" href="/" aria-label={`${BRAND.name} home`}>
          {BRAND.name}
        </a>
      </header>
      <main className="nf__main">
        <MascotLoop className="nf__mascot" src="/brand/loops/hero.mp4" poster="/brand/loops/hero.webp" />
        <p className="nf__note">404 · this page went missing</p>
        <h1 className="nf__title">We couldn&apos;t find that page.</h1>
        <p className="nf__sub">The link may be mistyped, or the page has moved. If you&apos;re looking for a song you made, open the link in your email.</p>
        <div className="nf__actions">
          <a className="nf__btn" href="/create">
            Make a song
          </a>
          <a className="nf__link" href="/">
            Go to the home page
          </a>
        </div>
      </main>
      <div className="nf__foot">
        <SiteFooter />
      </div>
    </div>
  );
}

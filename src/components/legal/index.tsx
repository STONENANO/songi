/**
 * Shared shell for the legal pages, and the footer links every public page should carry.
 * The policy text itself lives in each page (app/terms, app/privacy, app/refunds).
 */
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import "./legal.css";

/** Date the policies last changed. Update it whenever the text of any of them changes. */
export const POLICIES_UPDATED = "November 13, 2026";

/** The legal entity customers buy from. Set LEGAL_ENTITY_NAME once the company exists. */
export const legalEntity = () => (process.env.LEGAL_ENTITY_NAME || "").trim() || BRAND.name;

export function SupportLink() {
  const email = env.supportEmail;
  return email ? <a href={`mailto:${email}`}>{email}</a> : <>the contact address on our website</>;
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="legal">
      <main className="legal__inner">
        <a className="legal__brand" href="/">
          {BRAND.name}
        </a>
        <h1>{title}</h1>
        <p className="legal__updated">Last updated {POLICIES_UPDATED}</p>
        {children}
        <SiteFooter />
      </main>
    </div>
  );
}

export function SiteFooter({ className = "" }: { className?: string }) {
  const email = env.supportEmail;
  return (
    <footer className={`site-foot ${className}`}>
      <span>
        © {new Date().getFullYear()} {legalEntity()}
      </span>
      <nav aria-label="Legal">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/refunds">Refunds</a>
        {email && <a href={`mailto:${email}`}>Contact</a>}
      </nav>
    </footer>
  );
}

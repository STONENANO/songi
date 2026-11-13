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

/**
 * The footer on every public page (home and the legal pages): brand, how to start, how to get
 * help (support email, the refund promise) and the legal pages. Links into the home page use
 * the same anchors as the top menu.
 */
export function SiteFooter({ className = "" }: { className?: string }) {
  const email = env.supportEmail;
  const year = new Date().getFullYear();
  return (
    <footer className={`site-foot ${className}`}>
      <div className="site-foot__top">
        <div className="site-foot__brand">
          <a className="site-foot__name" href="/">
            {BRAND.name}
          </a>
          <p className="site-foot__tag">Make them cry happy tears.</p>
          <p className="site-foot__blurb">Original songs written from your story. Hear it free before you pay.</p>
          {email && (
            <a className="site-foot__mail" href={`mailto:${email}`}>
              ✉ {email}
            </a>
          )}
        </div>
        <nav className="site-foot__col" aria-label="Make a song">
          <h2>Make a song</h2>
          <ul>
            <li><a href="/create">Start a song</a></li>
            <li><a href="/#how">How it works</a></li>
            <li><a href="/#faq">Questions</a></li>
          </ul>
        </nav>
        <nav className="site-foot__col" aria-label="Help">
          <h2>Help</h2>
          <ul>
            {email && <li><a href={`mailto:${email}`}>Contact us</a></li>}
            <li>
              <a href="/refunds">Refunds</a> <span className="site-foot__pill">14-day</span>
            </li>
            <li><a href="/refunds">Wrong name? Fixed free</a></li>
          </ul>
        </nav>
        <nav className="site-foot__col site-foot__col--legal" aria-label="Legal">
          <h2>Legal</h2>
          <ul>
            <li><a href="/terms">Terms of Service</a></li>
            <li><a href="/privacy">Privacy Policy</a></li>
            <li><a href="/refunds">Refund Policy</a></li>
          </ul>
        </nav>
      </div>
      <div className="site-foot__bottom">
        <span>
          © {year} {legalEntity()} · Based in Georgia, USA
        </span>
        <span>Secure payments by Stripe</span>
      </div>
    </footer>
  );
}

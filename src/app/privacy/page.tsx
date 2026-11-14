import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import { LegalPage, SupportLink, legalEntity } from "@/components/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

/* Decisions (Nov 2026): seller "Cryworthy", based in Georgia, USA. Keep the provider list in step with the code. */
export default function Privacy() {
  const brand = BRAND.name;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what {legalEntity()} (&ldquo;{brand}&rdquo;) collects when you make a song with us, why, and who helps us process it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Your story:</b> the answers you give in the quiz, such as the recipient&rsquo;s name, your relationship, memories and music preferences.
        </li>
        <li>
          <b>Your email address:</b> to send your preview link and your song, and to limit free previews per person.
        </li>
        <li>
          <b>Payment details:</b> handled by Stripe. We receive the payment status, amount, and the billing address needed for tax, never your full card number.
        </li>
        <li>
          <b>Usage data:</b> pages viewed, quiz steps, device and browser type, and your IP address (for security, rate limits and fraud prevention). With analytics, we may record
          anonymised sessions of how the site is used; text you type is masked.
        </li>
        <li>
          <b>Advertising measurement:</b> our site uses the Meta Pixel, which sets cookies in your browser. When you start a song, open checkout or buy, we tell Meta (Facebook and
          Instagram) so we can measure and improve our ads. We send your email address in hashed (scrambled) form, the Meta cookies, your IP address and browser type, never your
          story, the recipient&rsquo;s details or your song.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To write and record your song, deliver it, take payment, provide support, prevent abuse, and improve the product. We don&rsquo;t sell your personal information and we
        don&rsquo;t use your story for advertising.
      </p>

      <h2>Who processes it for us</h2>
      <ul>
        <li>Anthropic (Claude): writes the lyrics from your story.</li>
        <li>Kie.ai, using Suno models: records the music from the lyrics and a style description.</li>
        <li>Stripe: payments and sales tax.</li>
        <li>Railway, Cloudflare (R2 storage, bot check) and Supabase: hosting, storage and security.</li>
        <li>PostHog (analytics) and Sentry (error reports, with story text and emails removed).</li>
        <li>Meta Platforms: advertising measurement (see above).</li>
        <li>Our email provider: sends your links.</li>
      </ul>
      <p>We&rsquo;re based in Georgia, USA. These providers may process data in the United States and other countries.</p>

      <h2>How long we keep it</h2>
      <p>
        Audio for versions nobody bought is deleted {env.previewRetentionDays} days after it was ready. We keep paid songs and order records for as long as needed to deliver your
        song and meet legal and tax obligations. You can ask us to delete your story and song at any time.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can ask to see, correct or delete your personal information, or object to its use, by writing to <SupportLink />. Depending on where you live (for example California,
        the EU or the UK), you may have further rights under local law, including the right to complain to a data protection authority.
      </p>

      <h2>Children</h2>
      <p>The site is not meant for children under 13, and we don&rsquo;t knowingly collect their information. Songs may be about children, written by an adult.</p>

      <h2>Changes</h2>
      <p>We&rsquo;ll post any changes here and update the date above.</p>

      <h2>Contact</h2>
      <p>
        <SupportLink />
      </p>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { env } from "@/lib/env";
import { LegalPage, SupportLink, legalEntity } from "@/components/legal";
import { getSongPrice } from "@/lib/commerce/pricing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };

/* DRAFT: have a lawyer review before relying on it. Search for "DRAFT" in app/ to find all three policies. */
export default async function Terms() {
  const price = await getSongPrice();
  const brand = BRAND.name;
  const entity = legalEntity();
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are an agreement between you and {entity} (&ldquo;{brand}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) for your use of this website and the personalised songs we
        make. By using the site or buying a song, you agree to them.
      </p>

      <h2>What we make</h2>
      <p>
        You tell us about a person and a moment. We use artificial intelligence to write lyrics from your story and to record several versions of a song. You can listen to previews
        for free and buy the version you like. Songs are made by AI: they are original but may not be perfect, and two songs from similar stories may share ideas or sounds.
      </p>

      <h2>Your story</h2>
      <ul>
        <li>Only share what you have the right to share. Don&rsquo;t include anything about someone that they would reasonably not want in a song.</li>
        <li>Don&rsquo;t ask for songs that are hateful, harassing, sexual about a minor, defamatory, or that infringe someone else&rsquo;s rights (for example, another artist&rsquo;s lyrics).</li>
        <li>We may refuse or stop making a song that breaks these rules, and refund you if you already paid.</li>
        <li>You give us permission to use your story to make, deliver and support your song. We don&rsquo;t publish your story or your song.</li>
      </ul>

      <h2>Price and payment</h2>
      <p>
        Previews are free. The full song costs the price shown before you pay (currently {price.label}, plus any sales tax shown at checkout). Payments are processed by Stripe; we
        never see or store your full card number.
      </p>

      <h2>What you can do with your song</h2>
      <p>
        Once you&rsquo;ve paid, you can keep, play, download and share your song for personal, non-commercial purposes: playing it at an event, sending it to family and friends,
        and posting it on your own social media. You may not sell it, license it, or release it on streaming services. Ask us at <SupportLink /> if you have another use in mind.
      </p>

      <h2>Delivery and access</h2>
      <p>
        After payment you get a permanent link to listen and download, on screen and by email. Preview links work for {env.previewLinkHours} hours, and versions nobody bought are
        deleted {env.previewRetentionDays} days after they were ready. Please download your song and keep your email: we keep paid songs, but we can&rsquo;t promise to store
        them forever.
      </p>

      <h2>Refunds</h2>
      <p>
        See our <a href="/refunds">refund policy</a>.
      </p>

      <h2>Our responsibility</h2>
      <p>
        The site and songs are provided &ldquo;as is&rdquo;. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability for any
        claim is limited to the amount you paid us for the song in question. Nothing in these terms limits rights you have under consumer law that can&rsquo;t be limited.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. The version in force when you bought a song applies to that purchase.</p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <SupportLink />.
      </p>
    </LegalPage>
  );
}

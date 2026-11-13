import type { Metadata } from "next";
import { LegalPage, SupportLink } from "@/components/legal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Refund Policy", alternates: { canonical: "/refunds" } };

/* Decision (Nov 2026): a full refund within 14 days, for any reason. Change REFUND_DAYS here and the home page FAQ together. */
const REFUND_DAYS = 14;

export default function Refunds() {
  return (
    <LegalPage title="Refund Policy">
      <p>
        You hear your song before you pay for it, so you know what you&rsquo;re getting. Still, if something&rsquo;s wrong, we want to make it right.
      </p>

      <h2>Problems we&rsquo;ll always fix</h2>
      <p>
        If your song has a mistake we made (a name sung wrong, a missing or broken file, audio that cuts out), write to <SupportLink /> and we&rsquo;ll fix it or give you a full
        refund.
      </p>

      <h2>Changed your mind</h2>
      <p>
        If you&rsquo;re not happy with your song for any other reason, write to us within {REFUND_DAYS} days of buying it and we&rsquo;ll refund you in full. Refunds go back to the
        original payment method, including any sales tax you paid, and usually appear within 5 to 10 business days.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <SupportLink /> with the email address you used and the recipient&rsquo;s name. You don&rsquo;t need to explain, but it helps us make better songs.
      </p>
    </LegalPage>
  );
}

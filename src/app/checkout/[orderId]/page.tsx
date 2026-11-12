import { notFound, redirect } from "next/navigation";
import { env } from "@/lib/env";
import { prepareCheckout } from "@/lib/commerce/orders";
import { loadCheckout } from "@/lib/commerce/checkout-page";
import { getGenre } from "@/lib/songcraft";
import { Banner, Button, Card, Checklist, Note, Screen, ScreenTitle } from "@/components/ui";
import PayForm from "./pay-form";

export const dynamic = "force-dynamic";

/** Our own checkout: the song, the price, and Stripe's Payment Element (card, Link, Apple Pay, Google Pay). */
export default async function Checkout({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const c = await loadCheckout(orderId);
  if (!c) notFound();
  if (!c.owner) {
    return (
      <Screen>
        <ScreenTitle title="This checkout was started on another device." subtitle="Open it from the browser you made the song in." />
      </Screen>
    );
  }
  const prep = await prepareCheckout(c.order);
  if (prep.kind === "paid") redirect(`/checkout/${orderId}/complete`);

  const price = prep.kind === "test" && prep.free ? "Free while testing" : prep.kind === "stripe" && prep.tax && env.stripe.taxBehavior === "exclusive" ? `${env.priceLabel} + tax` : env.priceLabel;
  return (
    <Screen>
      {prep.kind === "test" && <Banner>{prep.free ? "Free while we're testing. No card needed." : "Test checkout: no card is charged. Add Stripe keys for real payments."}</Banner>}
      <ScreenTitle eyebrow="Checkout" title={`${c.name}'s full song`} />
      <Card>
        <div className="ui-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <b>{c.version.title ?? `${c.name}'s Song`}</b>
          <b>{price}</b>
        </div>
        <Note>
          {c.version.variantLabel ?? getGenre(c.request.genreKey).label} · written for {c.name}
        </Note>
        <div className="ui-mt">
          <Checklist items={["The full song, every verse", "MP3 download, yours to keep", "A permanent link to share it"]} />
        </div>
      </Card>
      {prep.kind === "closed" ? (
        <Card tone="muted">
          <Note>This checkout is no longer open ({prep.reason.replace(/_/g, " ")}). Go back to the song to start again.</Note>
          <div className="ui-mt">
            <Button href={`/r/${c.request.id}`}>Back to the song</Button>
          </div>
        </Card>
      ) : (
        <PayForm
          orderId={orderId}
          requestId={c.request.id}
          mode={prep.kind === "stripe" ? { kind: "stripe", clientSecret: prep.clientSecret, publishableKey: prep.publishableKey, tax: prep.tax, hasEmail: prep.hasEmail } : { kind: "test", free: prep.free }}
          priceLabel={price}
          email={c.request.email ?? ""}
        />
      )}
    </Screen>
  );
}

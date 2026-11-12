import { notFound } from "next/navigation";
import { confirmFromReturn } from "@/lib/commerce/orders";
import { loadCheckout } from "@/lib/commerce/checkout-page";
import { deliveryToken } from "@/lib/media/tokens";
import { Button, Card, Checklist, Note, Screen, ScreenTitle } from "@/components/ui";
import Refresh from "./refresh";

export const dynamic = "force-dynamic";

/**
 * Post-purchase: where Stripe sends the buyer after paying. Confirms the payment with
 * Stripe directly (so it doesn't wait for the webhook), then hands over the song.
 * This is the place for post-purchase offers.
 */
export default async function Complete({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ redirect_status?: string }> }) {
  const { orderId } = await params;
  const { redirect_status } = await searchParams;
  const c = await loadCheckout(orderId);
  if (!c || !c.owner) notFound();
  const order = await confirmFromReturn(orderId);
  if (!order) notFound();
  const songPage = `/r/${c.request.id}`;

  if (order.status === "paid") {
    return (
      <Screen>
        <ScreenTitle eyebrow="Thank you" title={`${c.name}'s song is yours`} subtitle="Your receipt is on its way to your email." />
        <Card>
          <div className="ui-stack">
            <Button block href={songPage}>
              ▶ Listen and download
            </Button>
            <Button variant="secondary" block href={`/d/${deliveryToken(order.id)}`}>
              Open the gift page to share
            </Button>
          </div>
        </Card>
        <Card tone="muted" title={`Ways to give it to ${c.name}`}>
          <Checklist items={["Play it for them in person and film their reaction", "Send the gift page link in a message", "Save the MP3 to your phone for the car"]} />
        </Card>
      </Screen>
    );
  }
  if (order.status === "paid_unfulfilled") {
    return (
      <Screen>
        <ScreenTitle title="Payment received" subtitle={`We're preparing ${c.name}'s song file. We've been notified and will email it to you shortly.`} />
        <Button href={songPage}>Back to the song</Button>
      </Screen>
    );
  }
  if (order.status === "pending" && redirect_status !== "failed" && redirect_status !== "requires_payment_method") {
    return (
      <Screen>
        <Refresh />
        <ScreenTitle title="Confirming your payment…" subtitle="This usually takes a few seconds. This page updates on its own." />
        <Note>You can also go back to the song page; it unlocks as soon as the payment is confirmed.</Note>
      </Screen>
    );
  }
  return (
    <Screen>
      <ScreenTitle title="Your payment didn't go through" subtitle="No money was taken. You can try again with the same or a different payment method." />
      <div className="ui-stack">
        <Button href={`/checkout/${orderId}`}>Try again</Button>
        <Button variant="text" href={songPage}>
          Back to the song
        </Button>
      </div>
    </Screen>
  );
}

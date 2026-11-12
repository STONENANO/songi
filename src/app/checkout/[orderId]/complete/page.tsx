import { notFound, redirect } from "next/navigation";
import { confirmFromReturn } from "@/lib/commerce/orders";
import { loadCheckout } from "@/lib/commerce/checkout-page";
import { deliveryToken } from "@/lib/media/tokens";
import { Button, Note, Screen, ScreenTitle } from "@/components/ui";
import Refresh from "./refresh";

export const dynamic = "force-dynamic";

/**
 * Post-purchase: where Stripe sends the buyer after paying. Confirms the payment with
 * Stripe directly (so it doesn't wait for the webhook), then hands over the song.
 * A paid order goes straight to the song's player page (/d/<token>).
 */
export default async function Complete({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ redirect_status?: string }> }) {
  const { orderId } = await params;
  const { redirect_status } = await searchParams;
  const c = await loadCheckout(orderId);
  if (!c || !c.owner) notFound();
  const order = await confirmFromReturn(orderId);
  if (!order) notFound();
  const songPage = `/r/${c.request.id}`;

  // Paid: straight to the song's permanent player page, with a one-time thank-you.
  if (order.status === "paid") redirect(`/d/${deliveryToken(order.id)}?new=1`);
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

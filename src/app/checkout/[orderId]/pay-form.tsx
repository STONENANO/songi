"use client";
/**
 * The payment form. With Stripe keys: Stripe's Payment Element (card, Link, Apple Pay,
 * Google Pay) inside our page, styled from the theme tokens. Without: a test button.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { Button, Card, ErrorText, Note, TrustRow } from "@/components/ui";

type Mode = { kind: "stripe"; clientSecret: string; publishableKey: string } | { kind: "test"; free: boolean };

/** Read a theme token so Stripe's fields match the page (re-skins with theme.css). */
const token = (name: string, fallback: string) =>
  (typeof window !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

export default function PayForm({ orderId, requestId, mode, priceLabel, email }: { orderId: string; requestId: string; mode: Mode; priceLabel: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(mode.kind === "test");
  const [error, setError] = useState<string | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const payRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode.kind !== "stripe") return;
    let cancelled = false;
    void loadStripe(mode.publishableKey).then((stripe) => {
      if (!stripe || cancelled || !linkRef.current || !payRef.current) return;
      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret: mode.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: token("--color-primary", "#b4442e"),
            colorBackground: token("--color-surface", "#ffffff"),
            colorText: token("--color-text", "#2a211b"),
            colorDanger: token("--color-danger", "#b42318"),
            borderRadius: token("--radius-md", "14px"),
            fontFamily: token("--font-body", "system-ui, sans-serif"),
          },
        },
      });
      elementsRef.current = elements;
      // Link: an email field that recognises returning Link customers and fills their saved card.
      elements.create("linkAuthentication", { defaultValues: { email } }).mount(linkRef.current);
      const payment = elements.create("payment", { layout: "tabs" });
      payment.on("ready", () => setReady(true));
      payment.mount(payRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, email]);

  async function pay() {
    setBusy(true);
    setError(null);
    if (mode.kind === "test") {
      const res = await fetch("/api/dev/mock-pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) }).catch(() => null);
      if (!res?.ok) {
        setError("That didn't work. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/checkout/${orderId}/complete`);
      return;
    }
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return setBusy(false);
    // Stripe handles 3-D Secure and wallet sheets, then returns the buyer to our post-purchase page.
    const { error: err } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/checkout/${orderId}/complete` } });
    if (err) {
      setError(err.message ?? "Your payment didn't go through. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Card title={mode.kind === "stripe" ? "Payment" : undefined}>
      {mode.kind === "stripe" ? (
        <div className="ui-stack">
          <div ref={linkRef} />
          <div ref={payRef} />
          {!ready && <Note>Loading secure payment…</Note>}
        </div>
      ) : (
        <Note>{mode.free ? "No payment needed while we're testing." : "Test mode: this marks the order paid without charging a card."}</Note>
      )}
      {error && (
        <div className="ui-mt">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <div className="ui-mt ui-stack">
        <Button block disabled={busy || !ready} onClick={() => void pay()}>
          {busy ? "Processing…" : mode.kind === "test" ? (mode.free ? "Get my song" : "Pay (test)") : `Pay ${priceLabel}`}
        </Button>
        <TrustRow items={mode.kind === "stripe" ? ["Secure payment by Stripe", "Card, Link, Apple Pay, Google Pay"] : ["No card is charged"]} />
        <Button variant="text" href={`/r/${requestId}`}>
          Back to the song
        </Button>
      </div>
    </Card>
  );
}

"use client";
/**
 * The payment form. With Stripe keys: a Stripe Checkout Session rendered inside our page
 * (Checkout Elements: the Payment Element for card, Link, Apple Pay and Google Pay, plus a
 * billing address when Stripe Tax is on), styled from the theme tokens. Without: a test button.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type StripeCheckoutElementsSdk, type StripeCheckoutLoadActionsSuccess, type StripeCheckoutSession } from "@stripe/stripe-js";
import { Button, Card, ErrorText, Field, Note, TrustRow } from "@/components/ui";

type Mode = { kind: "stripe"; clientSecret: string; publishableKey: string; tax: boolean; hasEmail: boolean } | { kind: "test"; free: boolean };

/** Read a theme token so Stripe's fields match the page (re-skins with theme.css). */
const token = (name: string, fallback: string) =>
  (typeof window !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

type Totals = { subtotal: string; tax: string | null; total: string; taxReady: boolean };

function totalsOf(s: StripeCheckoutSession): Totals {
  const t = s.total;
  const hasTax = t.taxExclusive.minorUnitsAmount > 0 || t.taxInclusive.minorUnitsAmount > 0;
  return {
    subtotal: t.subtotal.amount,
    tax: hasTax ? (t.taxExclusive.minorUnitsAmount > 0 ? t.taxExclusive.amount : `${t.taxInclusive.amount} incl.`) : null,
    total: t.total.amount,
    taxReady: s.tax.status === "ready",
  };
}

export default function PayForm({ orderId, requestId, mode, priceLabel, email }: { orderId: string; requestId: string; mode: Mode; priceLabel: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(mode.kind === "test");
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [buyerEmail, setBuyerEmail] = useState(email);
  const actionsRef = useRef<StripeCheckoutLoadActionsSuccess | null>(null);
  const addressRef = useRef<HTMLDivElement>(null);
  const payRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode.kind !== "stripe") return;
    let cancelled = false;
    let sdk: StripeCheckoutElementsSdk | null = null;
    void (async () => {
      const stripe = await loadStripe(mode.publishableKey);
      if (!stripe || cancelled || !payRef.current) return;
      sdk = stripe.initCheckoutElementsSdk({
        clientSecret: mode.clientSecret,
        elementsOptions: {
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
        },
        // Only prefill when the session has no email: the server already sets customer_email when it
        // knows it, and Stripe refuses to change that ("You cannot update the email..."), which stops
        // the payment form from loading at all.
        defaultValues: email && !mode.hasEmail ? { email } : undefined,
      });
      // Totals update live: Stripe Tax recalculates as the buyer enters their address.
      sdk.on("change", (session) => setTotals(totalsOf(session)));
      // Stripe Tax needs to know where the buyer is.
      if (mode.tax && addressRef.current) sdk.createBillingAddressElement().mount(addressRef.current);
      const payment = sdk.createPaymentElement({ layout: "tabs" });
      payment.on("ready", () => setReady(true));
      payment.on("loaderror", (e) => setError(e.error?.message || "The payment form couldn't load. Please refresh the page."));
      payment.mount(payRef.current);
      const loaded = await sdk.loadActions().catch((e: Error) => ({ type: "error" as const, error: { message: e.message, code: null } }));
      if (cancelled) return;
      if (loaded.type === "error") return setError(loaded.error.message || "The payment form couldn't load. Please refresh the page.");
      actionsRef.current = loaded.actions;
      setTotals(totalsOf(loaded.actions.getSession()));
    })();
    return () => {
      cancelled = true;
      sdk?.getPaymentElement()?.destroy();
      sdk?.getBillingAddressElement()?.destroy();
    };
  }, [mode, email]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await payOnce();
    } catch (e) {
      // Never leave the buyer with a button that does nothing.
      setError((e as Error)?.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  async function payOnce() {
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
    const actions = actionsRef.current;
    if (!actions) {
      setError("The payment form is still loading. Please wait a moment and try again, or refresh the page.");
      setBusy(false);
      return;
    }
    if (!mode.hasEmail) {
      const upd = await actions.updateEmail(buyerEmail.trim());
      if (upd.type === "error") {
        setError(upd.error.message || "Please enter a valid email for your receipt.");
        setBusy(false);
        return;
      }
    }
    // Stripe handles 3-D Secure and wallet sheets, then returns the buyer to our post-purchase page.
    // Stripe redirects to the return URL itself; if it doesn't need to, we go there ourselves.
    const result = await actions.confirm({ redirect: "if_required" });
    if (result.type === "error") {
      setError(result.error.message || "Your payment didn't go through. Please try again.");
      setBusy(false);
      return;
    }
    router.push(`/checkout/${orderId}/complete`);
  }

  const payLabel = totals ? `Pay ${totals.total}` : `Pay ${priceLabel}`;
  return (
    <Card title={mode.kind === "stripe" ? "Payment" : undefined}>
      {mode.kind === "stripe" ? (
        <div className="ui-stack">
          {!mode.hasEmail && (
            <Field label="Email for your receipt">
              <input className="ui-input" type="email" autoComplete="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required />
            </Field>
          )}
          {mode.tax && <div ref={addressRef} />}
          <div ref={payRef} />
          {!ready && <Note>Loading secure payment…</Note>}
          {totals && (
            <div className="ui-stack">
              {totals.tax !== null || mode.tax ? (
                <>
                  <div className="ui-row" style={{ justifyContent: "space-between" }}>
                    <span>Song</span>
                    <span>{totals.subtotal}</span>
                  </div>
                  <div className="ui-row" style={{ justifyContent: "space-between" }}>
                    <span>Tax</span>
                    <span>{totals.tax ?? (totals.taxReady ? "None" : "Enter your address")}</span>
                  </div>
                </>
              ) : null}
              <div className="ui-row" style={{ justifyContent: "space-between" }}>
                <b>Total</b>
                <b>{totals.total}</b>
              </div>
            </div>
          )}
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
          {busy ? "Processing…" : mode.kind === "test" ? (mode.free ? "Get my song" : "Pay (test)") : payLabel}
        </Button>
        <TrustRow items={mode.kind === "stripe" ? ["Secure payment by Stripe", "Card, Link, Apple Pay, Google Pay"] : ["No card is charged"]} />
        <Button variant="text" href={`/r/${requestId}`}>
          Back to the song
        </Button>
      </div>
    </Card>
  );
}

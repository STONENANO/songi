"use client";

import { useState } from "react";

export default function MockPay({ orderId, requestId, alreadyPaid, free = false }: { orderId: string; requestId: string; alreadyPaid: boolean; free?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(alreadyPaid ? "This order is already completed." : null);
  async function pay() {
    setBusy(true);
    const res = await fetch("/api/dev/mock-pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? "Payment failed");
      setBusy(false);
      return;
    }
    window.location.href = `/r/${requestId}`;
  }
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <button className="btn" disabled={busy || alreadyPaid} onClick={pay}>
        {busy ? (free ? "Unlocking…" : "Paying…") : free ? "Get my song" : "Pay (test)"}
      </button>
      <a className="btn secondary" href={`/r/${requestId}`} style={{ textDecoration: "none" }}>
        Back to my song
      </a>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}

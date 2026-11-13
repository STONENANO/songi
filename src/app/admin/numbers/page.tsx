import Link from "next/link";
import { notFound } from "next/navigation";
import { adminAllowed } from "@/lib/admin";
import { loadNumbers, type Summary } from "@/lib/numbers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RANGES = [
  { days: "7", label: "7 days" },
  { days: "30", label: "30 days" },
  { days: "90", label: "90 days" },
  { days: "all", label: "All time" },
];

const usd = (n: number | null, digits = 2) => (n === null ? "-" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(digits)}`);
const cents = (n: number) => usd(n / 100);
const pct = (n: number | null) => (n === null ? "-" : `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`);

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="muted stat-note">{note}</div>}
    </div>
  );
}

function FunnelRow({ label, n, of, started }: { label: string; n: number; of: number | null; started: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{n}</td>
      <td>{of === null ? "" : pct(of > 0 ? n / of : null)}</td>
      <td>{pct(started > 0 ? n / started : null)}</td>
    </tr>
  );
}

function Groups({ title, rows, first }: { title: string; rows: { key: string; summary: Summary }[]; first: string }) {
  if (!rows.length) return null;
  return (
    <>
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{first}</th>
              <th>Songs</th>
              <th>Previews</th>
              <th>Paid</th>
              <th>Preview → paid</th>
              <th>AI cost</th>
              <th>Cost per buyer</th>
              <th>Net revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, summary: s }) => (
              <tr key={key}>
                <td>{key.replace(/_/g, " ")}</td>
                <td>{s.funnel.started}</td>
                <td>{s.funnel.previewsReady}</td>
                <td>{s.funnel.paid}</td>
                <td>{pct(s.rates.previewToPaid)}</td>
                <td>{usd(s.costs.totalUsd)}</td>
                <td>{usd(s.perUnit.costPerBuyerUsd)}</td>
                <td>{cents(s.money.netRevenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ token?: string; days?: string; ad?: string }> }) {
  const { token, days: daysParam, ad: adParam } = await searchParams;
  if (!adminAllowed(token)) notFound();
  const days = RANGES.some((r) => r.days === daysParam) ? daysParam! : "30";
  const since = days === "all" ? null : new Date(Date.now() - Number(days) * 24 * 60 * 60_000);
  const data = await loadNumbers(since);
  const t = data.total;
  const f = t.funnel;
  const adSpend = Math.max(0, Number(adParam) || 0);
  const tokenQ = token ? `token=${encodeURIComponent(token)}&` : "";
  const href = (d: string) => `/admin/numbers?${tokenQ}days=${d}${adSpend ? `&ad=${adSpend}` : ""}`;
  const be = t.breakEven;

  return (
    <div className="admin numbers">
      <p className="muted">
        <Link href={`/admin${token ? `?token=${encodeURIComponent(token)}` : ""}`}>Songs</Link> · <strong>Numbers</strong>
      </p>
      <h1>Numbers</h1>
      <p className="muted">
        Songs started in the last {days === "all" ? "(all time)" : `${days} days`}, with their costs and orders.{" "}
        {RANGES.map((r, i) => (
          <span key={r.days}>
            {i > 0 && " · "}
            {r.days === days ? <strong>{r.label}</strong> : <Link href={href(r.days)}>{r.label}</Link>}
          </span>
        ))}
      </p>

      <div className="stats">
        <Stat label="Preview → paid" value={pct(t.rates.previewToPaid)} note={`${f.paid} of ${f.previewsReady} songs with previews`} />
        <Stat label="AI cost per buyer" value={usd(t.perUnit.costPerBuyerUsd)} note="all AI spend ÷ buyers" />
        <Stat label="Profit per buyer" value={usd(t.perUnit.profitPerBuyerUsd)} note="after tax, refunds, Stripe and AI, before ads" />
        <Stat label="Profit" value={usd(t.profitUsd)} note={`${cents(t.money.netRevenueCents)} net revenue − ${usd(t.costs.totalUsd)} AI`} />
      </div>

      <div className="card">
        <strong>Break-even:</strong>{" "}
        {be.previewsPerSale === null ? (
          "needs at least one song with previews."
        ) : (
          <>
            each previewed song costs {usd(t.perUnit.costPerPreviewedSongUsd)}, and a sale brings in {usd(be.revenuePerSaleUsd)}
            {be.estimated ? " (estimated from today's price, no sales yet)" : ""}. So <strong>1 sale in every {Math.floor(be.previewsPerSale)} previewed songs</strong> covers
            the AI cost. {t.rates.previewToPaid !== null && f.paid > 0 ? `You're at 1 in ${(1 / t.rates.previewToPaid).toFixed(1)}.` : ""}
          </>
        )}
      </div>

      <h2>Funnel</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Songs</th>
              <th>Of previous step</th>
              <th>Of started</th>
            </tr>
          </thead>
          <tbody>
            <FunnelRow label="Finished the quiz (song started)" n={f.started} of={null} started={f.started} />
            <FunnelRow label="Previews ready" n={f.previewsReady} of={f.started} started={f.started} />
            <FunnelRow label="Picked a take" n={f.pickedTake} of={f.previewsReady} started={f.started} />
            <FunnelRow label="Reached checkout" n={f.reachedCheckout} of={f.pickedTake} started={f.started} />
            <FunnelRow label="Paid" n={f.paid} of={f.reachedCheckout} started={f.started} />
          </tbody>
        </table>
      </div>
      <p className="muted">
        Paid counts real Stripe payments only, minus refunds.{f.testUnlocks ? ` ${f.testUnlocks} free test unlock${f.testUnlocks === 1 ? "" : "s"} not counted.` : ""} Quiz screens before
        &quot;started&quot; are in PostHog (Cryworthy: conversion dashboard). Upsell take rate: no upsell is offered yet.
      </p>

      <h2>Money</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr><td>Charged to cards (tax included)</td><td>{cents(t.money.chargedCents)}</td></tr>
            <tr><td>− Sales tax collected</td><td>{cents(t.money.taxCents)}</td></tr>
            <tr><td>− Refunds ({t.money.refunds})</td><td>{cents(t.money.refundedCents)}</td></tr>
            <tr><td>− Stripe fees (est. {data.fee.percent}% + {data.fee.fixedCents}¢)</td><td>{cents(t.money.stripeFeesCents)}</td></tr>
            <tr><td><strong>Net revenue</strong></td><td><strong>{cents(t.money.netRevenueCents)}</strong></td></tr>
            <tr><td>− Kie (music generation)</td><td>{usd(t.costs.kieUsd)}</td></tr>
            <tr><td>− Claude (brief, lyrics, checks)</td><td>{usd(t.costs.claudeUsd)}</td></tr>
            <tr><td>− Claude (quiz follow-up questions, incl. people who never finished)</td><td>{usd(t.costs.quizQuestionsUsd)}</td></tr>
            <tr><td><strong>Profit before ads</strong></td><td><strong>{usd(t.profitUsd)}</strong></td></tr>
          </tbody>
        </table>
      </div>

      <h2>Per unit</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            <tr><td>AI cost per song started</td><td>{usd(t.perUnit.costPerSongUsd, 3)}</td></tr>
            <tr><td>AI cost per song with previews</td><td>{usd(t.perUnit.costPerPreviewedSongUsd, 3)}</td></tr>
            <tr><td>AI cost per buyer</td><td>{usd(t.perUnit.costPerBuyerUsd)}</td></tr>
            <tr><td>Net revenue per buyer</td><td>{usd(t.perUnit.revenuePerBuyerUsd)}</td></tr>
            <tr><td>Profit per buyer (before ads)</td><td>{usd(t.perUnit.profitPerBuyerUsd)}</td></tr>
          </tbody>
        </table>
      </div>

      <h2>With ad spend</h2>
      <form method="get" action="/admin/numbers" className="row">
        {token && <input type="hidden" name="token" value={token} />}
        <input type="hidden" name="days" value={days} />
        <label htmlFor="ad" style={{ margin: 0 }}>Ad spend for this period ($)</label>
        <input id="ad" name="ad" type="number" min="0" step="0.01" defaultValue={adSpend || ""} style={{ width: 140 }} />
        <button className="btn secondary" type="submit">Calculate</button>
      </form>
      {adSpend > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>Cost to acquire a buyer (ads ÷ buyers)</td><td>{usd(f.paid ? adSpend / f.paid : null)}</td></tr>
              <tr><td>Ad cost per song started</td><td>{usd(f.started ? adSpend / f.started : null)}</td></tr>
              <tr><td>Return on ad spend (net revenue ÷ ads)</td><td>{(t.money.netRevenueCents / 100 / adSpend).toFixed(2)}x</td></tr>
              <tr><td>All-in cost per buyer (ads + AI)</td><td>{usd(f.paid ? (adSpend + t.costs.totalUsd) / f.paid : null)}</td></tr>
              <tr><td><strong>Profit after ads</strong></td><td><strong>{usd(t.profitUsd - adSpend)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}

      <Groups title="By week started" rows={data.weeks} first="Week of" />
      <Groups title="By occasion" rows={data.occasions} first="Occasion" />

      <p className="muted">
        AI costs are estimates from the cost ledger (KIE_TASK_COST_USD and the LLM_*_COST_PER_MTOK rates), not invoices: compare with your Kie.ai and Anthropic
        bills monthly. Songs count in the period they were started, with all their later costs and orders.
      </p>
    </div>
  );
}

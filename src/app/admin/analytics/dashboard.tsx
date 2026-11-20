"use client";

import Link from "next/link";
import { useState } from "react";
import type { GroupRow, Report, Totals } from "@/lib/analytics/report";
import { Funnel, HBars, LineChart, PairedBars, Sparkline } from "./charts";

const C = { visitors: "var(--an-visitors)", quiz: "var(--an-quiz)", buy: "var(--an-buy)" };
const nf = new Intl.NumberFormat("en-US");
const fmtN = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : nf.format(n));
const usd = (n: number | null, digits = 2) => (n == null ? "–" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
const pct = (r: number | null) => (r == null || !isFinite(r) ? "–" : `${(r * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`);
const pct2 = (r: number | null) => (r == null ? "–" : `${(r * 100).toFixed(r < 0.1 ? 2 : 1)}%`);
const dayLabel = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const occasionLabel = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function Delta({ cur, prev, upIsGood = true, show }: { cur: number | null; prev: number | null | undefined; upIsGood?: boolean; show: boolean }) {
  if (!show || cur == null || prev == null || prev === 0) return <div className="delta">vs previous period: –</div>;
  const ch = (cur - prev) / Math.abs(prev);
  const good = ch >= 0 === upIsGood;
  return <div className={`delta ${Math.abs(ch) < 0.005 ? "" : good ? "up" : "down"}`}>{`${ch >= 0 ? "↑" : "↓"} ${Math.abs(ch * 100).toFixed(0)}% vs previous period`}</div>;
}

function Kpi(p: { label: string; value: string; cur: number | null; prev: number | null | undefined; upIsGood?: boolean; spark?: (number | null)[]; color?: string; hero?: boolean; show: boolean }) {
  return (
    <div className={`card kpi${p.hero ? " hero" : ""}`}>
      <div className="label">{p.label}</div>
      <div className="value">{p.value}</div>
      <Delta cur={p.cur} prev={p.prev} upIsGood={p.upIsGood} show={p.show} />
      {p.spark && p.color && <Sparkline values={p.spark} color={p.color} />}
    </div>
  );
}

function BreakEven({ t }: { t: Totals }) {
  const { rate, actual, aiPerPreviewUsd, netPerSaleUsd } = t.breakEven;
  const good = rate != null && actual != null && actual >= rate;
  const top = Math.max(actual ?? 0, rate ?? 0) * 1.15 || 1;
  const at = (r: number) => Math.min(100, (r / top) * 100);
  return (
    <div className="breakeven">
      <div className="be-head">
        <div>
          <div className="be-label">Break-even conversion</div>
          <div className="be-sub">of previewed songs need to sell to cover the AI cost</div>
        </div>
        <div className="be-value">{pct2(rate)}</div>
      </div>
      {rate != null && actual != null && (
        <>
          <div className={`be-chip ${good ? "good" : "bad"}`}>
            {good ? `✓ Above break-even: you're at ${pct2(actual)}, ${(actual / rate).toFixed(actual / rate >= 10 ? 0 : 1)}× the rate needed` : `✕ Below break-even: you're at ${pct2(actual)}, need ${pct2(rate)}`}
          </div>
          <div className="be-scale" role="img" aria-label={`Break-even ${pct2(rate)}, actual ${pct2(actual)}`}>
            <div className={`be-fill ${good ? "good" : "bad"}`} style={{ width: `${Math.max(1, at(actual))}%` }} />
            <div className={`be-mark${at(rate) > 80 ? " right" : at(rate) < 12 ? " left" : ""}`} style={{ left: `calc(${at(rate)}% - 1px)` }}>
              <span>{`Break-even ${pct2(rate)}`}</span>
            </div>
            <div className={`be-you${at(actual) < 25 ? " left" : ""}`} style={{ left: `${at(actual)}%` }}>{`You: ${pct2(actual)}`}</div>
          </div>
        </>
      )}
      <div className="be-foot">
        {aiPerPreviewUsd != null && netPerSaleUsd != null && netPerSaleUsd > 0
          ? `${usd(aiPerPreviewUsd)} AI cost per previewed song ÷ ${usd(netPerSaleUsd)} net revenue per sale${rate ? ` (1 in ${Math.round(1 / rate)})` : ""}.`
          : "Needs a sale in this period to work out."}
      </div>
    </div>
  );
}

function AdSpend({ t }: { t: Totals }) {
  const [spend, setSpend] = useState("");
  const ads = Math.max(0, Number(spend) || 0);
  return (
    <details className="adspend">
      <summary>Add ad spend for this period</summary>
      <label>
        Ad spend ($)
        <input inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label="Ad spend for this period in dollars" />
      </label>
      {ads > 0 && (
        <table className="money" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <td>Cost to get a buyer (ads ÷ purchases)</td>
              <td>{usd(t.purchases ? ads / t.purchases : null)}</td>
            </tr>
            <tr>
              <td>Return on ad spend (net revenue ÷ ads)</td>
              <td>{`${(t.netRevenueCents / 100 / ads).toFixed(2)}×`}</td>
            </tr>
            <tr className="total">
              <td>Gross profit after ads</td>
              <td>{usd(t.grossProfitUsd - ads)}</td>
            </tr>
            <tr className="total">
              <td>Per buyer, after ads</td>
              <td>{usd(t.purchases ? (t.grossProfitUsd - ads) / t.purchases : null)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </details>
  );
}

function GroupTable({ rows, first }: { rows: GroupRow[]; first: string }) {
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>{first}</th>
            <th>Quiz completes</th>
            <th>Purchases</th>
            <th>Quiz → buy</th>
            <th>Net revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key + (r.campaign ?? "")} className={r.key.startsWith("(") ? "quiet" : ""}>
              <td>{r.campaign ? `${r.key} · ${r.campaign}` : r.key}</td>
              <td>{nf.format(r.quizCompletes)}</td>
              <td>{nf.format(r.purchases)}</td>
              <td>{pct(r.quizCompletes ? r.purchases / r.quizCompletes : null)}</td>
              <td>{usd(r.netRevenueUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard({ report: r, ranges, email, testMode, priceLabel }: { report: Report; ranges: { id: string; label: string }[]; email: string | null; testMode: boolean; priceLabel: string }) {
  const t = r.totals;
  const p = r.previous;
  const f = r.funnel;
  const labels = r.days.map(dayLabel);
  const since = r.visitorsSince;
  const counted = (i: number) => !!since && r.days[i] >= since;
  const visitorsSeries = r.daily.map((d, i) => (counted(i) ? d.visitors : null));
  const rateSeries = r.daily.map((d, i) => (counted(i) ? d.conversionRate : null));
  const grossSeries = r.daily.map((d) => d.grossProfitUsd);
  const showDelta = r.hasPrevious;
  const period = r.days.length === 1 ? dayLabel(r.days[0]) : `${dayLabel(r.days[0])} – ${dayLabel(r.days[r.days.length - 1])}`;
  const money = (n: number) => usd(n, Math.abs(n) >= 1000 ? 0 : 2);
  const ads = r.byAd.filter((a) => !a.key.startsWith("("));

  return (
    <div className="an">
      <div className="wrap">
        <header className="top">
          <Link className="brand" href="/admin">
            <i aria-hidden="true" />
            Cryworthy
          </Link>
          <nav className="tabs" aria-label="Admin">
            <Link href="/admin">Songs</Link>
            <Link href="/admin/analytics" aria-current="page">
              Analytics
            </Link>
          </nav>
          {email && (
            <form className="who" method="post" action="/admin/logout">
              <span>{email}</span>
              <button type="submit">Sign out</button>
            </form>
          )}
        </header>

        <div className="title-row">
          <div>
            <h1>Analytics</h1>
            <div className="sub">{period}</div>
          </div>
          <nav className="seg" aria-label="Date range">
            {ranges.map((x) => (
              <Link key={x.id} href={`/admin/analytics?range=${x.id}`} aria-current={x.id === r.range ? "true" : undefined}>
                {x.label}
              </Link>
            ))}
          </nav>
        </div>

        {testMode && (
          <div className="banner">
            <span aria-hidden="true">🧪</span>
            <div>
              <b>Stripe is in test mode.</b> Purchases and revenue below are test payments, not real money. They switch to real sales once live keys are set.
            </div>
          </div>
        )}
        {(!since || r.funnelPartial) && (
          <div className="banner info">
            <span aria-hidden="true">👀</span>
            <div>
              {since
                ? `Visitors are counted from ${dayLabel(since)}. The funnel and conversion rate use ${dayLabel(since)} onward, so they compare the same days.`
                : "No visitors counted yet in this period. Counting starts as people open the site (bots and your own signed-in browser are skipped)."}
            </div>
          </div>
        )}

        <div className="grid kpis">
          <Kpi label="Conversion rate" value={pct(f?.conversionRate ?? null)} cur={f?.conversionRate ?? null} prev={r.funnelPartial ? null : p?.conversionRate} show={showDelta} spark={rateSeries} color={C.buy} hero />
          <Kpi label="Visitors" value={fmtN(t.visitors)} cur={t.visitors} prev={p?.visitors} show={showDelta} spark={visitorsSeries} color={C.visitors} />
          <Kpi label="Quiz completes" value={fmtN(t.quizCompletes)} cur={t.quizCompletes} prev={p?.quizCompletes} show={showDelta} spark={r.daily.map((d) => d.quizCompletes)} color={C.quiz} />
          <Kpi label="Purchases" value={fmtN(t.purchases)} cur={t.purchases} prev={p?.purchases} show={showDelta} spark={r.daily.map((d) => d.purchases)} color={C.buy} />
          <Kpi label="Net revenue" value={money(t.netRevenueCents / 100)} cur={t.netRevenueCents} prev={p?.netRevenueCents} show={showDelta} spark={r.daily.map((d) => d.netRevenueUsd)} color={C.buy} />
          <Kpi label="Gross profit" value={money(t.grossProfitUsd)} cur={t.grossProfitUsd} prev={p?.grossProfitUsd} show={showDelta} spark={grossSeries} color={C.buy} hero />
          <Kpi label="Gross profit per buyer" value={usd(t.grossProfitPerBuyerUsd)} cur={t.grossProfitPerBuyerUsd} prev={p?.grossProfitPerBuyerUsd} show={showDelta} hero />
          <Kpi label="AI cost per buyer" value={usd(t.aiCostPerBuyerUsd)} cur={t.aiCostPerBuyerUsd} prev={p?.aiCostPerBuyerUsd} upIsGood={false} show={showDelta} />
        </div>

        <section className="card section">
          <h2>Conversion funnel</h2>
          <p className="hint">{`How many visitors finish the quiz, and how many of those buy. ${since ? `${r.funnelPartial ? `${dayLabel(since)} – ${dayLabel(r.days[r.days.length - 1])}` : period}.` : ""}`}</p>
          {f ? (
            <>
              <Funnel
                steps={[
                  { name: "Visitors", value: f.visitors, color: C.visitors },
                  { name: "Quiz completes", value: f.quizCompletes, color: C.quiz },
                  { name: "Purchased", value: f.purchases, color: C.buy },
                ]}
                fmt={fmtN}
                pct={pct}
              />
              <div className="funnel-foot">
                <span>
                  Visitor → quiz complete: <b>{pct(f.visitors ? f.quizCompletes / f.visitors : null)}</b>
                </span>
                <span>
                  Quiz complete → purchase: <b>{pct(f.quizCompletes ? f.purchases / f.quizCompletes : null)}</b>
                </span>
                <span>
                  Visitor → purchase: <b>{pct(f.conversionRate)}</b>
                </span>
              </div>
              <details>
                <summary>Every step</summary>
                <div className="scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>People</th>
                        <th>Of previous</th>
                        <th>Of visitors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Visitors", f.visitors],
                          ["Started the quiz", f.quizStarts],
                          ["Finished the quiz", f.quizCompletes],
                          ["Previews ready", f.previews],
                          ["Reached checkout", f.reachedCheckout],
                          ["Purchased", f.purchases],
                        ] as const
                      ).map(([n, v], i, all) => (
                        <tr key={n}>
                          <td>{n}</td>
                          <td>{nf.format(v)}</td>
                          <td>{i ? pct(all[i - 1][1] ? v / all[i - 1][1] : null) : ""}</td>
                          <td>{pct(f.visitors ? v / f.visitors : null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note">Quiz starts are counted per browser tab. Free test unlocks ({f.testUnlocks}) aren&apos;t purchases.</p>
              </details>
            </>
          ) : (
            <div className="empty">The funnel starts once visitors are counted.</div>
          )}
        </section>

        <div className="grid two section">
          <section className="card">
            <h2>Visitors over time</h2>
            <p className="hint">People who visited the site, per day</p>
            <LineChart labels={labels} series={[{ name: "Visitors", color: C.visitors, values: visitorsSeries }]} format={(v) => nf.format(v)} axisFormat={(v) => fmtN(Math.round(v))} label="Visitors per day" />
          </section>
          <section className="card">
            <h2>Conversion rate over time</h2>
            <p className="hint">Purchases ÷ visitors, per day</p>
            <LineChart labels={labels} series={[{ name: "Conversion rate", color: C.buy, values: rateSeries }]} format={pct} axisFormat={(v) => `${+(v * 100).toFixed(1)}%`} label="Conversion rate per day" />
          </section>
        </div>

        <div className="grid two section">
          <section className="card">
            <h2>Quiz completes and purchases</h2>
            <p className="hint">Per day</p>
            <LineChart
              labels={labels}
              series={[
                { name: "Quiz completes", color: C.quiz, values: r.daily.map((d) => d.quizCompletes) },
                { name: "Purchases", color: C.buy, values: r.daily.map((d) => d.purchases) },
              ]}
              format={(v) => nf.format(v)}
              axisFormat={(v) => fmtN(Math.round(v))}
              label="Quiz completes and purchases per day"
            />
          </section>
          <section className="card">
            <h2>Net revenue and gross profit</h2>
            <p className="hint">Per day. Gross profit = net revenue − that day&apos;s AI cost</p>
            <LineChart
              labels={labels}
              series={[
                { name: "Net revenue", color: C.visitors, values: r.daily.map((d) => d.netRevenueUsd) },
                { name: "Gross profit", color: C.buy, values: grossSeries },
              ]}
              format={(v) => usd(v)}
              axisFormat={(v) => `${v < 0 ? "−" : ""}$${fmtN(Math.round(Math.abs(v)))}`}
              label="Net revenue and gross profit per day"
            />
          </section>
        </div>

        <div className="grid two section">
          <section className="card">
            <h2>Money</h2>
            <p className="hint">{testMode ? "Test payments while Stripe is in test mode" : period}</p>
            <table className="money">
              <tbody>
                <tr>
                  <td>Charged to cards (tax included)</td>
                  <td>{usd(t.chargedCents / 100)}</td>
                </tr>
                <tr>
                  <td className="minus">− Sales tax</td>
                  <td>{usd(t.taxCents / 100)}</td>
                </tr>
                <tr>
                  <td className="minus">{`− Refunds (${t.refunds})`}</td>
                  <td>{usd(t.refundedCents / 100)}</td>
                </tr>
                <tr>
                  <td className="minus">− Stripe fees (est.)</td>
                  <td>{usd(t.stripeFeesCents / 100)}</td>
                </tr>
                <tr className="total">
                  <td>Net revenue</td>
                  <td>{usd(t.netRevenueCents / 100)}</td>
                </tr>
                <tr>
                  <td className="minus">− AI cost (all songs, bought or not)</td>
                  <td>{usd(t.aiUsd)}</td>
                </tr>
                <tr className="total">
                  <td>Gross profit</td>
                  <td>{usd(t.grossProfitUsd)}</td>
                </tr>
                <tr className="total">
                  <td>Gross profit per buyer</td>
                  <td>{usd(t.grossProfitPerBuyerUsd)}</td>
                </tr>
              </tbody>
            </table>
            <BreakEven t={t} />
            <AdSpend t={t} />
          </section>
          <section className="card">
            <h2>Quiz completes and purchases by occasion</h2>
            <p className="hint">Songs started in this period, and whether they were bought</p>
            <div className="legend">
              <span>
                <i className="box" style={{ background: C.quiz }} />
                Quiz completes
              </span>
              <span>
                <i className="box" style={{ background: C.buy }} />
                Purchases
              </span>
            </div>
            <PairedBars rows={r.byOccasion.map((o) => ({ label: occasionLabel(o.key), a: o.quizCompletes, b: o.purchases }))} colors={[C.quiz, C.buy]} pct={pct} />
          </section>
        </div>

        <section className="card section">
          <h2>Purchases by ad</h2>
          <p className="hint">Songs started in this period by the ad they came from (the last tagged link before the song), and whether they were bought</p>
          <HBars
            rows={ads.map((a) => ({ label: a.key, sub: a.campaign, value: a.purchases }))}
            color={C.buy}
            fmt={(n) => nf.format(n)}
            empty="No tagged ads in this period. Add the UTM URL parameters to your Meta ads and this fills in."
          />
          <GroupTable rows={r.byAd} first="Ad · campaign" />
          <details>
            <summary>By campaign and by source</summary>
            <GroupTable rows={r.byCampaign} first="Campaign (utm_campaign)" />
            <GroupTable rows={r.bySource} first="Source (utm_source)" />
          </details>
        </section>

        <p className="note">
          {`Days run midnight to midnight, ${r.tz}. AI costs are estimates from the cost ledger (compare with your Kie.ai and Anthropic bills); Stripe fees are estimated. Song price: ${priceLabel}.`}
        </p>
      </div>
    </div>
  );
}

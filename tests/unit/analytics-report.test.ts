import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, dailySeries, dayKey, daysSince, groupSongs, adKey, periodDays, stripeFeeCents, totalsFor, UNTAGGED, type OrderRow, type ReportInput, type SongRow } from "../../src/lib/analytics/report";

const TZ = "America/New_York";
const FEE = { percent: 2.9, fixedCents: 30 };
const close = (a: number | null, b: number, msg?: string) => assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} != ${b}`);
const at = (iso: string) => new Date(iso);
const day = (k: string) => new Set([k]);

/** Nov 13 (New York): 10 visitors, 4 songs (3 with previews), 1 real sale, 1 free test unlock, $1.60 of AI. */
function sample(): ReportInput {
  const song = (id: string, o: Partial<SongRow> = {}): SongRow => ({ id, at: at("2026-11-13T15:00:00Z"), occasion: "birthday", previewsReady: true, ...o });
  const order = (requestId: string, o: Partial<OrderRow> = {}): OrderRow => ({ requestId, status: "paid", amountCents: 3900, taxCents: 0, real: true, createdAt: at("2026-11-13T16:00:00Z"), paidAt: at("2026-11-13T16:05:00Z"), refundedAt: null, ...o });
  return {
    visits: [...Array.from({ length: 10 }, (_, i) => ({ visitor: `v${i}`, at: at("2026-11-13T14:00:00Z") })), { visitor: "v0", at: at("2026-11-13T20:00:00Z") }],
    quizStarts: [{ session: "s1", at: at("2026-11-13T14:10:00Z") }, { session: "s2", at: at("2026-11-13T14:20:00Z") }, { session: "s2", at: at("2026-11-13T14:21:00Z") }],
    songs: [song("a", { ad: "hook_v2", campaign: "Q4", source: "facebook" }), song("b", { ad: "hook_v2", campaign: "Q4", source: "facebook" }), song("c"), song("d", { previewsReady: false })],
    orders: [order("a"), order("c", { real: false, amountCents: 0 })],
    costs: Array.from({ length: 10 }, () => ({ at: at("2026-11-13T15:30:00Z"), usd: 0.16 })),
  };
}

test("days follow the analytics time zone, across the November clock change", () => {
  assert.equal(dayKey(at("2026-11-14T03:00:00Z"), TZ), "2026-11-13", "11pm in New York is still the 13th");
  assert.equal(dayKey(at("2026-11-14T05:00:00Z"), TZ), "2026-11-14");
  const { days, previous } = periodDays(at("2026-11-03T15:00:00Z"), 3, TZ);
  assert.deepEqual(days, ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.deepEqual(previous, ["2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.equal(periodDays(at("2026-11-14T15:00:00Z"), 30, TZ).days.length, 30);
  assert.deepEqual(daysSince(at("2026-11-12T14:50:00Z"), at("2026-11-14T15:00:00Z"), TZ), ["2026-11-12", "2026-11-13", "2026-11-14"]);
});

test("conversion, gross profit and gross profit per buyer", () => {
  const t = totalsFor(sample(), day("2026-11-13"), TZ, FEE);
  assert.equal(t.visitors, 10, "a visitor counts once a day");
  assert.equal(t.quizStarts, 2);
  assert.equal(t.quizCompletes, 4);
  assert.equal(t.previews, 3);
  assert.equal(t.purchases, 1, "the free test unlock isn't a purchase");
  assert.equal(t.testUnlocks, 1);
  close(t.conversionRate, 0.1, "purchases / visitors");
  assert.equal(t.stripeFeesCents, stripeFeeCents(3900, FEE));
  assert.equal(t.netRevenueCents, 3900 - 143);
  close(t.aiUsd, 1.6);
  close(t.grossProfitUsd, 37.57 - 1.6, "net revenue - all AI cost");
  close(t.grossProfitPerBuyerUsd, 35.97);
  close(t.aiCostPerBuyerUsd, 1.6);
});

test("break-even: the share of previewed songs that must sell to cover the AI cost", () => {
  const t = totalsFor(sample(), day("2026-11-13"), TZ, FEE);
  close(t.breakEven.aiPerPreviewUsd, 1.6 / 3);
  close(t.breakEven.netPerSaleUsd, 37.57);
  close(t.breakEven.rate, 1.6 / 3 / 37.57, "about 1.4%: 1 in 70");
  close(t.breakEven.actual, 1 / 3);
  const none = totalsFor({ ...sample(), orders: [] }, day("2026-11-13"), TZ, FEE);
  assert.equal(none.breakEven.rate, null, "needs a sale to work out");
});

test("tax isn't revenue; a refund lands on its own day and Stripe keeps its fee", () => {
  const input = sample();
  input.orders[0] = { ...input.orders[0], amountCents: 4212, taxCents: 312, status: "refunded", refundedAt: at("2026-11-15T15:00:00Z") };
  const sale = totalsFor(input, day("2026-11-13"), TZ, FEE);
  assert.equal(sale.purchases, 1, "still a purchase on the day it was paid");
  assert.equal(sale.netRevenueCents, 4212 - 312 - stripeFeeCents(4212, FEE));
  const refundDay = totalsFor(input, day("2026-11-15"), TZ, FEE);
  assert.equal(refundDay.refunds, 1);
  assert.equal(refundDay.netRevenueCents, -(4212 - 312));
  assert.equal(refundDay.purchases, 0);
});

test("daily series add up to the period totals", () => {
  const input = sample();
  input.visits.push({ visitor: "v9", at: at("2026-11-14T15:00:00Z") });
  input.costs.push({ at: at("2026-11-14T15:00:00Z"), usd: 0.5 });
  const days = ["2026-11-13", "2026-11-14"];
  const daily = dailySeries(input, days, TZ, FEE);
  const t = totalsFor(input, new Set(days), TZ, FEE);
  close(daily.reduce((s, d) => s + d.aiUsd, 0), t.aiUsd);
  close(daily.reduce((s, d) => s + d.netRevenueUsd, 0), t.netRevenueCents / 100);
  close(daily.reduce((s, d) => s + d.grossProfitUsd, 0), t.grossProfitUsd);
  assert.equal(daily[1].visitors, 1);
  close(daily[1].grossProfitUsd, -0.5, "a day with AI cost and no sales loses money");
  assert.equal(t.visitors, 10, "v9 visited both days: one visitor in the period");
});

test("by ad follows each song to its purchase, even if paid days later", () => {
  const input = sample();
  input.orders[0] = { ...input.orders[0], paidAt: at("2026-11-20T15:00:00Z") };
  const rows = groupSongs(input, day("2026-11-13"), TZ, FEE, adKey, (s) => s.campaign);
  assert.deepEqual(rows.map((r) => [r.key, r.campaign, r.quizCompletes, r.purchases]), [["hook_v2", "Q4", 2, 1], [UNTAGGED, undefined, 2, 0]]);
  close(rows[0].netRevenueUsd, 37.57);
});

test("the report: totals, previous period and when visitor counting began", () => {
  const r = buildReport(sample(), { range: "7", days: ["2026-11-13"], previous: ["2026-11-12"], tz: TZ, fee: FEE });
  assert.equal(r.totals.purchases, 1);
  assert.equal(r.previous?.purchases, 0);
  assert.equal(r.hasPrevious, true);
  assert.equal(r.visitorsSince, "2026-11-13");
  assert.equal(r.byOccasion[0].key, "birthday");
  const all = buildReport({ ...sample(), visits: [] }, { range: "all", days: ["2026-11-13"], previous: null, tz: TZ, fee: FEE });
  assert.equal(all.previous, null);
  assert.equal(all.visitorsSince, null);
  assert.equal(all.totals.conversionRate, null, "no visitors counted: no conversion rate rather than infinity");
});

test("the funnel only uses days when visitors were counted", () => {
  const input = sample();
  // A sale on Nov 12, before visitor counting began on Nov 13.
  input.songs.push({ id: "old", at: at("2026-11-12T15:00:00Z"), occasion: "birthday", previewsReady: true });
  input.orders.push({ requestId: "old", status: "paid", amountCents: 3900, taxCents: 0, real: true, createdAt: at("2026-11-12T16:00:00Z"), paidAt: at("2026-11-12T16:05:00Z"), refundedAt: null });
  const r = buildReport(input, { range: "7", days: ["2026-11-12", "2026-11-13"], previous: null, tz: TZ, fee: FEE });
  assert.equal(r.totals.purchases, 2, "the period totals keep every sale");
  assert.equal(r.funnel?.purchases, 1, "the funnel leaves out the day without visitor counts");
  close(r.funnel?.conversionRate ?? null, 0.1);
  assert.equal(r.funnelPartial, true);
  const none = buildReport({ ...input, visits: [] }, { range: "7", days: ["2026-11-12", "2026-11-13"], previous: null, tz: TZ, fee: FEE });
  assert.equal(none.funnel, null);
});

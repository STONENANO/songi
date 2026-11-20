/**
 * The numbers behind /admin/analytics, as plain functions over rows (tested without a database).
 *
 * Everything counts on the day it happened, in ANALYTICS_TIMEZONE: visits on the visit day,
 * quiz completes when the song was started, purchases and revenue when paid, refunds when
 * refunded, AI cost when it was spent. So daily charts add up to the totals, and "vs previous
 * period" compares like with like. The by-ad and by-occasion tables are the exception: they
 * follow each song started in the period to whether it was bought (any time since).
 *
 * Gross profit = net revenue (after sales tax, refunds and estimated Stripe fees) minus ALL AI
 * cost in the period, including songs nobody bought and the quiz's follow-up questions.
 * AI costs are the cost ledger's estimates, not invoices.
 */

export type FeeRule = { percent: number; fixedCents: number };

export type VisitRow = { visitor: string; at: Date };
export type QuizStartRow = { session: string; at: Date };
export type SongRow = {
  id: string;
  at: Date;
  occasion: string;
  previewsReady: boolean;
  /** Last ad or link before the song (UTM tags). */
  source?: string;
  campaign?: string;
  ad?: string;
};
export type OrderRow = {
  requestId: string;
  status: string;
  amountCents: number | null;
  taxCents: number | null;
  /** Went through Stripe (not the free test checkout). */
  real: boolean;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
};
export type CostRow = { at: Date; usd: number };
export type ReportInput = { visits: VisitRow[]; quizStarts: QuizStartRow[]; songs: SongRow[]; orders: OrderRow[]; costs: CostRow[] };

/** Orders that took money (a refund doesn't give Stripe's fee back). */
const CHARGED = new Set(["paid", "paid_unfulfilled", "refunded", "duplicate_payment"]);
/** Orders whose buyer kept the song. */
const KEPT = new Set(["paid", "paid_unfulfilled", "refunded"]);
/** Songs that came without UTM tags: typed-in, organic, or an untagged link. */
export const UNTAGGED = "(no UTM tags)";

export function stripeFeeCents(amountCents: number, fee: FeeRule): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * fee.percent) / 100 + fee.fixedCents);
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Each row's Date is looked up many times (once per day of the range): remember its day. */
const dayCache = new Map<string, WeakMap<Date, string>>();

/** Calendar day (YYYY-MM-DD) of a moment in a time zone. */
export function dayKey(d: Date, timeZone: string): string {
  let cache = dayCache.get(timeZone);
  if (!cache) dayCache.set(timeZone, (cache = new WeakMap()));
  const hit = cache.get(d);
  if (hit) return hit;
  let f = formatters.get(timeZone);
  if (!f) formatters.set(timeZone, (f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })));
  const key = f.format(d);
  cache.set(d, key);
  return key;
}

/** The last `n` calendar days ending today (oldest first), and the `n` before them. */
export function periodDays(now: Date, n: number, timeZone: string): { days: string[]; previous: string[] } {
  const keys: string[] = [];
  // Step back in 12-hour hops so DST changes can't skip or repeat a day.
  for (let t = now.getTime(); keys.length < 2 * n; t -= 12 * 3600_000) {
    const k = dayKey(new Date(t), timeZone);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return { days: keys.slice(0, n).reverse(), previous: keys.slice(n, 2 * n).reverse() };
}

/** Every calendar day from `first` to `now` (for "All time"). */
export function daysSince(first: Date, now: Date, timeZone: string): string[] {
  const keys: string[] = [];
  for (let t = first.getTime(); t <= now.getTime() + 12 * 3600_000; t += 12 * 3600_000) {
    const k = dayKey(new Date(Math.min(t, now.getTime())), timeZone);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

export type Totals = {
  visitors: number;
  quizStarts: number;
  quizCompletes: number;
  previews: number;
  reachedCheckout: number;
  purchases: number;
  testUnlocks: number;
  chargedCents: number;
  taxCents: number;
  refundedCents: number;
  refunds: number;
  stripeFeesCents: number;
  netRevenueCents: number;
  aiUsd: number;
  grossProfitUsd: number;
  /** null when there's no denominator. */
  conversionRate: number | null;
  grossProfitPerBuyerUsd: number | null;
  aiCostPerBuyerUsd: number | null;
  breakEven: { aiPerPreviewUsd: number | null; netPerSaleUsd: number | null; rate: number | null; actual: number | null };
};

export type Daily = { day: string; visitors: number; quizCompletes: number; purchases: number; netRevenueUsd: number; aiUsd: number; grossProfitUsd: number; conversionRate: number | null };
export type GroupRow = { key: string; campaign?: string; quizCompletes: number; purchases: number; netRevenueUsd: number };

/** Totals for the days in `days`. */
export function totalsFor(input: ReportInput, days: Set<string>, tz: string, fee: FeeRule): Totals {
  const inP = (d: Date | null) => !!d && days.has(dayKey(d, tz));
  const visitors = new Set(input.visits.filter((v) => inP(v.at)).map((v) => v.visitor)).size;
  const quizStarts = new Set(input.quizStarts.filter((q) => inP(q.at)).map((q) => q.session)).size;
  const songs = input.songs.filter((s) => inP(s.at));
  const paidInP = input.orders.filter((o) => inP(o.paidAt));
  const charged = paidInP.filter((o) => o.real && CHARGED.has(o.status));
  const purchases = new Set(paidInP.filter((o) => o.real && KEPT.has(o.status)).map((o) => o.requestId)).size;
  const testUnlocks = new Set(paidInP.filter((o) => !o.real && KEPT.has(o.status)).map((o) => o.requestId)).size;
  // Refunds land on the day they happen; a duplicate payment is refunded money from the start.
  const refunded = input.orders.filter((o) => o.real && ((o.status === "refunded" && inP(o.refundedAt)) || (o.status === "duplicate_payment" && inP(o.paidAt))));
  const chargedCents = charged.reduce((s, o) => s + (o.amountCents ?? 0), 0);
  const taxCents = charged.reduce((s, o) => s + (o.taxCents ?? 0), 0);
  const refundedCents = refunded.reduce((s, o) => s + (o.amountCents ?? 0) - (o.taxCents ?? 0), 0);
  const stripeFeesCents = charged.reduce((s, o) => s + stripeFeeCents(o.amountCents ?? 0, fee), 0);
  const netRevenueCents = chargedCents - taxCents - refundedCents - stripeFeesCents;
  const aiUsd = input.costs.filter((c) => inP(c.at)).reduce((s, c) => s + c.usd, 0);
  const grossProfitUsd = netRevenueCents / 100 - aiUsd;
  const previews = songs.filter((s) => s.previewsReady).length;
  const aiPerPreviewUsd = ratio(aiUsd, previews);
  const netPerSaleUsd = ratio(netRevenueCents / 100, purchases);
  return {
    visitors,
    quizStarts,
    quizCompletes: songs.length,
    previews,
    reachedCheckout: new Set(input.orders.filter((o) => inP(o.createdAt)).map((o) => o.requestId)).size,
    purchases,
    testUnlocks,
    chargedCents,
    taxCents,
    refundedCents,
    refunds: refunded.length,
    stripeFeesCents,
    netRevenueCents,
    aiUsd,
    grossProfitUsd,
    conversionRate: ratio(purchases, visitors),
    grossProfitPerBuyerUsd: ratio(grossProfitUsd, purchases),
    aiCostPerBuyerUsd: ratio(aiUsd, purchases),
    breakEven: {
      aiPerPreviewUsd,
      netPerSaleUsd,
      // The share of previewed songs that must sell for net revenue to cover the AI cost.
      rate: aiPerPreviewUsd != null && netPerSaleUsd != null && netPerSaleUsd > 0 ? aiPerPreviewUsd / netPerSaleUsd : null,
      actual: ratio(purchases, previews),
    },
  };
}

export function dailySeries(input: ReportInput, days: string[], tz: string, fee: FeeRule): Daily[] {
  return days.map((day) => {
    const t = totalsFor(input, new Set([day]), tz, fee);
    return {
      day,
      visitors: t.visitors,
      quizCompletes: t.quizCompletes,
      purchases: t.purchases,
      netRevenueUsd: t.netRevenueCents / 100,
      aiUsd: t.aiUsd,
      grossProfitUsd: t.grossProfitUsd,
      conversionRate: t.conversionRate,
    };
  });
}

/** Songs started in the period, grouped (by ad, occasion...), with whether each was bought and for how much. */
export function groupSongs(input: ReportInput, days: Set<string>, tz: string, fee: FeeRule, key: (s: SongRow) => string, campaignOf?: (s: SongRow) => string | undefined): GroupRow[] {
  const groups = new Map<string, GroupRow>();
  const keptBySong = new Map<string, OrderRow>();
  for (const o of input.orders) if (o.real && (o.status === "paid" || o.status === "paid_unfulfilled")) keptBySong.set(o.requestId, o);
  for (const s of input.songs) {
    if (!days.has(dayKey(s.at, tz))) continue;
    const k = key(s);
    const g = groups.get(k) ?? { key: k, campaign: campaignOf?.(s), quizCompletes: 0, purchases: 0, netRevenueUsd: 0 };
    g.quizCompletes++;
    const kept = keptBySong.get(s.id);
    if (kept) {
      g.purchases++;
      const amount = kept.amountCents ?? 0;
      g.netRevenueUsd += (amount - (kept.taxCents ?? 0) - stripeFeeCents(amount, fee)) / 100;
    }
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.purchases - a.purchases || b.quizCompletes - a.quizCompletes || a.key.localeCompare(b.key));
}

export const adKey = (s: SongRow) => (s.ad ? s.ad : s.source ? `(${s.source}, no ad tag)` : UNTAGGED);
export const campaignKey = (s: SongRow) => s.campaign || (s.source ? `(${s.source}, no campaign tag)` : UNTAGGED);
export const sourceKey = (s: SongRow) => s.source || UNTAGGED;

export type Report = {
  range: string;
  /** Time zone the days are counted in. */
  tz: string;
  days: string[];
  hasPrevious: boolean;
  totals: Totals;
  previous: Totals | null;
  daily: Daily[];
  byAd: GroupRow[];
  byCampaign: GroupRow[];
  bySource: GroupRow[];
  byOccasion: GroupRow[];
  /** First day visitors were counted (null: none yet). */
  visitorsSince: string | null;
  /**
   * The funnel and conversion rate over the days in the range when visitors were counted, so
   * visitors are compared with the purchases of those same days. null: no counted days.
   */
  funnel: Totals | null;
  /** True when part of the range is before visitor counting began. */
  funnelPartial: boolean;
};

export function buildReport(input: ReportInput, opts: { range: string; days: string[]; previous: string[] | null; tz: string; fee: FeeRule }): Report {
  const { days, previous, tz, fee } = opts;
  const set = new Set(days);
  const firstVisit = input.visits.reduce<Date | null>((m, v) => (!m || v.at < m ? v.at : m), null);
  const visitorsSince = firstVisit ? dayKey(firstVisit, tz) : null;
  const counted = visitorsSince ? days.filter((d) => d >= visitorsSince) : [];
  return {
    range: opts.range,
    tz,
    days,
    hasPrevious: !!previous?.length,
    totals: totalsFor(input, set, tz, fee),
    previous: previous?.length ? totalsFor(input, new Set(previous), tz, fee) : null,
    daily: dailySeries(input, days, tz, fee),
    byAd: groupSongs(input, set, tz, fee, adKey, (s) => s.campaign),
    byCampaign: groupSongs(input, set, tz, fee, campaignKey),
    bySource: groupSongs(input, set, tz, fee, sourceKey),
    byOccasion: groupSongs(input, set, tz, fee, (s) => s.occasion),
    visitorsSince,
    funnel: counted.length ? totalsFor(input, new Set(counted), tz, fee) : null,
    funnelPartial: counted.length > 0 && counted.length < days.length,
  };
}

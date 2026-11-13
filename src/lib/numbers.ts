/**
 * Unit economics for /admin/numbers: funnel, revenue, AI cost and margin per buyer.
 *
 * Songs are grouped by the day they were started (a cohort): a song started in the
 * period counts with its costs and its orders, even if it was paid for later.
 * Costs are the cost ledger's ESTIMATES (Kie task price and per-token rates from
 * the environment), not provider invoices. Stripe fees are estimated from
 * STRIPE_FEE_PERCENT and STRIPE_FEE_FIXED_CENTS.
 */
import { and, gte, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "./db";
import { env } from "./env";

export type NumbersSong = { id: string; createdAt: Date; occasion: string; previewsReady: boolean; pickedTake: boolean };
export type NumbersOrder = {
  requestId: string;
  status: string;
  amountCents: number | null;
  taxCents: number | null;
  /** Went through Stripe (not the free test checkout). */
  real: boolean;
};
export type NumbersCost = { requestId: string | null; provider: string; costUsd: number };
export type NumbersInput = { songs: NumbersSong[]; orders: NumbersOrder[]; costs: NumbersCost[] };
export type FeeRule = { percent: number; fixedCents: number };

/** Orders that took money at some point (a refund doesn't give Stripe's fee back). */
const CHARGED = new Set(["paid", "paid_unfulfilled", "refunded", "duplicate_payment"]);
/** Orders whose buyer kept the song. */
const KEPT = new Set(["paid", "paid_unfulfilled"]);

export type Funnel = { started: number; previewsReady: number; pickedTake: number; reachedCheckout: number; paid: number; testUnlocks: number };
export type Money = {
  /** Charged to cards, tax included. */
  chargedCents: number;
  taxCents: number;
  refundedCents: number;
  refunds: number;
  stripeFeesCents: number;
  /** Charged minus tax, refunds and Stripe fees: what you keep before AI costs. */
  netRevenueCents: number;
};
export type Costs = { claudeUsd: number; kieUsd: number; quizQuestionsUsd: number; totalUsd: number };
export type Summary = {
  funnel: Funnel;
  money: Money;
  costs: Costs;
  /** null when the denominator is 0. */
  rates: { startToPaid: number | null; previewToPaid: number | null; checkoutToPaid: number | null };
  perUnit: {
    costPerSongUsd: number | null;
    costPerPreviewedSongUsd: number | null;
    costPerBuyerUsd: number | null;
    revenuePerBuyerUsd: number | null;
    profitPerBuyerUsd: number | null;
  };
  profitUsd: number;
  /** How many previewed songs one sale can pay for, at today's cost per previewed song. */
  breakEven: { previewsPerSale: number | null; revenuePerSaleUsd: number; estimated: boolean };
};

export function stripeFeeCents(amountCents: number, fee: FeeRule): number {
  if (amountCents <= 0) return 0;
  return Math.round((amountCents * fee.percent) / 100 + fee.fixedCents);
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function summarize(input: NumbersInput, fee: FeeRule, priceCents: number): Summary {
  const songIds = new Set(input.songs.map((s) => s.id));
  const orders = input.orders.filter((o) => songIds.has(o.requestId));
  const realCharged = orders.filter((o) => o.real && CHARGED.has(o.status));
  const buyers = new Set(orders.filter((o) => o.real && KEPT.has(o.status)).map((o) => o.requestId));
  const testUnlocks = new Set(orders.filter((o) => !o.real && KEPT.has(o.status)).map((o) => o.requestId));
  const withOrder = new Set(orders.map((o) => o.requestId));

  const funnel: Funnel = {
    started: input.songs.length,
    previewsReady: input.songs.filter((s) => s.previewsReady).length,
    pickedTake: input.songs.filter((s) => s.pickedTake || withOrder.has(s.id)).length,
    reachedCheckout: withOrder.size,
    paid: buyers.size,
    testUnlocks: testUnlocks.size,
  };

  const chargedCents = realCharged.reduce((s, o) => s + (o.amountCents ?? 0), 0);
  const taxCents = realCharged.reduce((s, o) => s + (o.taxCents ?? 0), 0);
  const refunded = realCharged.filter((o) => o.status === "refunded" || o.status === "duplicate_payment");
  const refundedCents = refunded.reduce((s, o) => s + (o.amountCents ?? 0) - (o.taxCents ?? 0), 0);
  const stripeFeesCents = realCharged.reduce((s, o) => s + stripeFeeCents(o.amountCents ?? 0, fee), 0);
  const money: Money = {
    chargedCents,
    taxCents,
    refundedCents,
    refunds: refunded.length,
    stripeFeesCents,
    netRevenueCents: chargedCents - taxCents - refundedCents - stripeFeesCents,
  };

  const songCosts = input.costs.filter((c) => c.requestId && songIds.has(c.requestId));
  const sum = (xs: NumbersCost[]) => xs.reduce((s, c) => s + c.costUsd, 0);
  const costs: Costs = {
    claudeUsd: sum(songCosts.filter((c) => c.provider.startsWith("anthropic"))),
    kieUsd: sum(songCosts.filter((c) => c.provider.startsWith("kie"))),
    quizQuestionsUsd: sum(input.costs.filter((c) => !c.requestId)),
    totalUsd: 0,
  };
  costs.totalUsd = costs.claudeUsd + costs.kieUsd + costs.quizQuestionsUsd + sum(songCosts.filter((c) => !c.provider.startsWith("anthropic") && !c.provider.startsWith("kie")));

  const netRevenueUsd = money.netRevenueCents / 100;
  const profitUsd = netRevenueUsd - costs.totalUsd;
  const costPerPreviewedSongUsd = ratio(costs.totalUsd, funnel.previewsReady);
  // Without sales yet, estimate one sale at today's price after Stripe's fee.
  const estimated = funnel.paid === 0;
  const revenuePerSaleUsd = estimated ? (priceCents - stripeFeeCents(priceCents, fee)) / 100 : netRevenueUsd / funnel.paid;

  return {
    funnel,
    money,
    costs,
    rates: {
      startToPaid: ratio(funnel.paid, funnel.started),
      previewToPaid: ratio(funnel.paid, funnel.previewsReady),
      checkoutToPaid: ratio(funnel.paid, funnel.reachedCheckout),
    },
    perUnit: {
      costPerSongUsd: ratio(costs.totalUsd, funnel.started),
      costPerPreviewedSongUsd,
      costPerBuyerUsd: ratio(costs.totalUsd, funnel.paid),
      revenuePerBuyerUsd: ratio(netRevenueUsd, funnel.paid),
      profitPerBuyerUsd: ratio(profitUsd, funnel.paid),
    },
    profitUsd,
    breakEven: {
      previewsPerSale: costPerPreviewedSongUsd && costPerPreviewedSongUsd > 0 && revenuePerSaleUsd > 0 ? revenuePerSaleUsd / costPerPreviewedSongUsd : null,
      revenuePerSaleUsd,
      estimated,
    },
  };
}

/** Monday 00:00 UTC of the song's week, as YYYY-MM-DD. */
export function weekOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Split the songs into groups (by week, by occasion...) and summarize each. Quiz-question costs stay in the total only. */
export function summarizeBy(input: NumbersInput, key: (s: NumbersSong) => string, fee: FeeRule, priceCents: number): { key: string; summary: Summary }[] {
  const groups = new Map<string, NumbersSong[]>();
  for (const s of input.songs) groups.set(key(s), [...(groups.get(key(s)) ?? []), s]);
  return [...groups.entries()].map(([k, songs]) => ({
    key: k,
    summary: summarize({ songs, orders: input.orders, costs: input.costs.filter((c) => c.requestId) }, fee, priceCents),
  }));
}

export type NumbersPage = { since: Date | null; total: Summary; weeks: { key: string; summary: Summary }[]; occasions: { key: string; summary: Summary }[]; fee: FeeRule; priceCents: number };

/** Load every song started since `since` (null = all time) with its orders and costs. */
export async function loadNumbers(since: Date | null): Promise<NumbersPage> {
  const db = await getDb();
  const { songRequests, orders, costLedger } = schema;
  const reqs = await db
    .select({ id: songRequests.id, createdAt: songRequests.createdAt, occasion: songRequests.occasion, finalizedAt: songRequests.candidatesFinalizedAt, selected: songRequests.selectedVersionId, status: songRequests.status })
    .from(songRequests)
    .where(since ? gte(songRequests.createdAt, since) : undefined);
  const ids = reqs.map((r) => r.id);
  const [ords, songCosts, quizCosts] = await Promise.all([
    ids.length ? db.select().from(orders).where(inArray(orders.requestId, ids)) : Promise.resolve([]),
    ids.length ? db.select({ requestId: costLedger.requestId, provider: costLedger.provider, costUsd: costLedger.costUsd }).from(costLedger).where(inArray(costLedger.requestId, ids)) : Promise.resolve([]),
    db
      .select({ requestId: costLedger.requestId, provider: costLedger.provider, costUsd: costLedger.costUsd })
      .from(costLedger)
      .where(since ? and(isNull(costLedger.requestId), gte(costLedger.createdAt, since)) : isNull(costLedger.requestId)),
  ]);
  const input: NumbersInput = {
    songs: reqs.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      occasion: r.occasion,
      previewsReady: !!r.finalizedAt || r.status === "preview_ready" || r.status === "purchased",
      pickedTake: !!r.selected,
    })),
    orders: ords.map((o) => ({ requestId: o.requestId, status: o.status, amountCents: o.amountCents, taxCents: o.taxCents, real: !!(o.stripePaymentIntentId || o.stripeCheckoutSessionId) })),
    costs: [...songCosts, ...quizCosts].map((c) => ({ requestId: c.requestId, provider: c.provider, costUsd: Number(c.costUsd ?? 0) })),
  };
  const fee = env.stripeFee;
  const priceCents = env.songPriceCents;
  return {
    since,
    total: summarize(input, fee, priceCents),
    weeks: summarizeBy(input, (s) => weekOf(s.createdAt), fee, priceCents).sort((a, b) => b.key.localeCompare(a.key)),
    occasions: summarizeBy(input, (s) => s.occasion, fee, priceCents).sort((a, b) => b.summary.funnel.started - a.summary.funnel.started),
    fee,
    priceCents,
  };
}

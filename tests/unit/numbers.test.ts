import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, summarizeAttribution, summarizeBy, UNTAGGED, stripeFeeCents, weekOf, type NumbersInput, type NumbersSong } from "../../src/lib/numbers";

const FEE = { percent: 2.9, fixedCents: 30 };
const PRICE = 3900;
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${a} != ${b}`);

function song(id: string, o: Partial<NumbersSong> = {}): NumbersSong {
  return { id, createdAt: new Date("2026-11-10T12:00:00Z"), occasion: "birthday", previewsReady: true, pickedTake: false, ...o };
}

/** 10 songs with previews at $0.16 each; one real $39 sale. The user's "1 in 10" case. */
function tenPreviewsOneSale(): NumbersInput {
  const songs = Array.from({ length: 10 }, (_, i) => song(`s${i}`, { pickedTake: i < 3 }));
  return {
    songs,
    orders: [{ requestId: "s0", status: "paid", amountCents: 3900, taxCents: 0, real: true }],
    costs: songs.flatMap((s) => [
      { requestId: s.id, provider: "kie-suno", costUsd: 0.13 },
      { requestId: s.id, provider: "anthropic", costUsd: 0.03 },
    ]),
  };
}

test("stripe fee is percent plus fixed, nothing on a free order", () => {
  assert.equal(stripeFeeCents(3900, FEE), 143); // 113.1 + 30
  assert.equal(stripeFeeCents(0, FEE), 0);
});

test("cost per buyer is all AI spend divided by buyers", () => {
  const s = summarize(tenPreviewsOneSale(), FEE, PRICE);
  close(s.costs.totalUsd, 1.6);
  close(s.perUnit.costPerPreviewedSongUsd, 0.16);
  close(s.perUnit.costPerBuyerUsd, 1.6); // 10 previews × $0.16 for one sale
  close(s.rates.previewToPaid, 0.1);
  assert.equal(s.money.stripeFeesCents, 143);
  assert.equal(s.money.netRevenueCents, 3757);
  close(s.profitUsd, 37.57 - 1.6);
  // A $37.57 sale covers 234.8 previewed songs at $0.16 each.
  close(s.breakEven.previewsPerSale, 37.57 / 0.16);
  assert.equal(s.breakEven.estimated, false);
});

test("free test unlocks are not revenue or buyers", () => {
  const input = tenPreviewsOneSale();
  input.orders.push({ requestId: "s1", status: "paid", amountCents: 0, taxCents: 0, real: false });
  const s = summarize(input, FEE, PRICE);
  assert.equal(s.funnel.paid, 1);
  assert.equal(s.funnel.testUnlocks, 1);
  assert.equal(s.funnel.reachedCheckout, 2);
  assert.equal(s.money.chargedCents, 3900);
});

test("a refund removes the buyer and the revenue but Stripe keeps its fee", () => {
  const input = tenPreviewsOneSale();
  input.orders[0] = { ...input.orders[0], status: "refunded" };
  const s = summarize(input, FEE, PRICE);
  assert.equal(s.funnel.paid, 0);
  assert.equal(s.money.refunds, 1);
  assert.equal(s.money.netRevenueCents, -143);
  assert.equal(s.perUnit.costPerBuyerUsd, null);
  // No sales left: break-even uses today's price after the fee.
  assert.equal(s.breakEven.estimated, true);
  close(s.breakEven.revenuePerSaleUsd, 37.57);
});

test("tax is charged but not revenue", () => {
  const input = tenPreviewsOneSale();
  input.orders[0] = { ...input.orders[0], amountCents: 4212, taxCents: 312 };
  const s = summarize(input, FEE, PRICE);
  assert.equal(s.money.chargedCents, 4212);
  assert.equal(s.money.netRevenueCents, 4212 - 312 - stripeFeeCents(4212, FEE));
});

test("quiz follow-up costs (no song yet) count toward cost per buyer", () => {
  const input = tenPreviewsOneSale();
  input.costs.push({ requestId: null, provider: "anthropic", costUsd: 0.4 });
  const s = summarize(input, FEE, PRICE);
  close(s.costs.quizQuestionsUsd, 0.4);
  close(s.perUnit.costPerBuyerUsd, 2.0);
});

test("orders and costs of songs outside the period are ignored", () => {
  const input = tenPreviewsOneSale();
  input.orders.push({ requestId: "old", status: "paid", amountCents: 3900, taxCents: 0, real: true });
  input.costs.push({ requestId: "old", provider: "kie-suno", costUsd: 5 });
  const s = summarize(input, FEE, PRICE);
  assert.equal(s.funnel.paid, 1);
  close(s.costs.totalUsd, 1.6);
});

test("empty period has no rates instead of dividing by zero", () => {
  const s = summarize({ songs: [], orders: [], costs: [] }, FEE, PRICE);
  assert.equal(s.rates.previewToPaid, null);
  assert.equal(s.perUnit.costPerBuyerUsd, null);
  assert.equal(s.breakEven.previewsPerSale, null);
});

test("weeks start on Monday (UTC)", () => {
  assert.equal(weekOf(new Date("2026-11-12T23:00:00Z")), "2026-11-09"); // Thursday
  assert.equal(weekOf(new Date("2026-11-09T00:00:00Z")), "2026-11-09"); // Monday
  assert.equal(weekOf(new Date("2026-11-15T23:59:00Z")), "2026-11-09"); // Sunday
});

test("groups split songs and keep each group's own orders and costs", () => {
  const input = tenPreviewsOneSale();
  input.songs[0].occasion = "anniversary";
  const by = new Map(summarizeBy(input, (s) => s.occasion, FEE, PRICE).map((g) => [g.key, g.summary]));
  assert.equal(by.get("anniversary")!.funnel.paid, 1);
  assert.equal(by.get("birthday")!.funnel.paid, 0);
  close(by.get("birthday")!.costs.totalUsd, 1.44);
});

test("sales by source, campaign and ad: most paid first, untagged songs grouped", () => {
  const input = tenPreviewsOneSale();
  // s0 (the buyer) and s1 from ad hook_v2; s2 from hook_v1; s3 from facebook without an ad tag; the rest untagged.
  Object.assign(input.songs[0], { source: "facebook", campaign: "Q4 Moms", ad: "hook_v2" });
  Object.assign(input.songs[1], { source: "facebook", campaign: "Q4 Moms", ad: "hook_v2" });
  Object.assign(input.songs[2], { source: "facebook", campaign: "Q4 Moms", ad: "hook_v1" });
  Object.assign(input.songs[3], { source: "facebook" });
  const { sources, campaigns, ads } = summarizeAttribution(input, FEE, PRICE);
  assert.deepEqual(sources.map((g) => [g.key, g.summary.funnel.started, g.summary.funnel.paid]), [["facebook", 4, 1], [UNTAGGED, 6, 0]]);
  assert.equal(campaigns[0].key, "Q4 Moms");
  assert.equal(campaigns[0].summary.funnel.started, 3);
  assert.ok(campaigns.some((g) => g.key === "(facebook, no campaign tag)"));
  assert.equal(ads[0].key, "hook_v2  ·  Q4 Moms", "the ad with the sale comes first");
  assert.equal(ads[0].summary.funnel.paid, 1);
  assert.equal(ads[0].summary.funnel.started, 2);
  close(ads[0].summary.rates.previewToPaid, 0.5);
  assert.ok(ads.some((g) => g.key === "(facebook, no ad tag)"));
  assert.ok(ads.some((g) => g.key === UNTAGGED));
});

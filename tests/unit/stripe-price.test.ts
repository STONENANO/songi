import "../setup";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { formatPrice, getCheckoutPrice, getSongPrice, invalidateSongPrice, setPriceFetcherForTests, stripePriceProblem, type SongPrice } from "../../src/lib/commerce/pricing";

const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRODUCT_ID", "STRIPE_PRICE_ID", "SONG_PRICE_CENTS", "SONG_CURRENCY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  setPriceFetcherForTests(null);
});

const stripePrice = (cents: number, id = "price_a"): SongPrice => ({ cents, currency: "usd", label: formatPrice(cents, "usd"), priceId: id, productId: "prod_x", productName: "Custom Song", taxBehavior: "exclusive", source: "stripe" });
function fromStripe() {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_PRODUCT_ID = "prod_x";
  process.env.SONG_PRICE_CENTS = "3900";
}

test("pricing: without a Stripe product, the price comes from SONG_PRICE_CENTS", async () => {
  delete process.env.STRIPE_PRODUCT_ID;
  delete process.env.STRIPE_PRICE_ID;
  process.env.SONG_PRICE_CENTS = "4500";
  const p = await getSongPrice();
  assert.equal(p.cents, 4500);
  assert.equal(p.label, "$45");
  assert.equal(p.priceId, null);
});

test("pricing: with STRIPE_PRODUCT_ID, the site shows Stripe's price, and follows a change after invalidation", async () => {
  fromStripe();
  let cents = 7997;
  let calls = 0;
  setPriceFetcherForTests(async () => (calls++, stripePrice(cents)));
  assert.equal((await getSongPrice()).label, "$79.97");
  assert.equal((await getSongPrice()).cents, 7997);
  assert.equal(calls, 1, "cached: one Stripe read for many page views");
  cents = 8997; // changed in the Dashboard; the price.created webhook arrives
  invalidateSongPrice();
  assert.equal((await getCheckoutPrice()).cents, 8997, "checkout re-reads a stale price before selling");
  assert.equal((await getSongPrice()).cents, 8997);
});

test("pricing: when Stripe fails, pages keep the last good price; before any, SONG_PRICE_CENTS; checkout refuses", async () => {
  fromStripe();
  const quiet = console.error;
  console.error = () => {};
  try {
    setPriceFetcherForTests(async () => {
      throw new Error("Stripe is down");
    });
    assert.equal((await getSongPrice()).cents, 3900, "never loaded: settings fallback, no crash");
    await assert.rejects(getCheckoutPrice(), /Stripe is down/, "checkout never sells a guessed price");

    let fail = false;
    setPriceFetcherForTests(async () => {
      if (fail) throw new Error("Stripe is down");
      return stripePrice(7997);
    });
    assert.equal((await getSongPrice()).cents, 7997);
    fail = true;
    invalidateSongPrice();
    assert.equal((await getSongPrice()).cents, 7997, "stale but good beats nothing");
    await new Promise((r) => setTimeout(r, 10)); // let the failed background refresh settle
    assert.equal((await getSongPrice()).cents, 7997);
  } finally {
    console.error = quiet;
  }
});

test("pricing: only an active, one-time, fixed-amount price can be sold", () => {
  const base = { id: "price_x", active: true, type: "one_time" as const, unit_amount: 7997, currency: "usd", billing_scheme: "per_unit" as const };
  assert.equal(stripePriceProblem(base), null);
  assert.match(stripePriceProblem({ ...base, active: false })!, /archived/);
  assert.match(stripePriceProblem({ ...base, type: "recurring" })!, /one-time/);
  assert.match(stripePriceProblem({ ...base, unit_amount: null })!, /fixed amount/);
  assert.match(stripePriceProblem({ ...base, billing_scheme: "tiered" })!, /tiered/);
});

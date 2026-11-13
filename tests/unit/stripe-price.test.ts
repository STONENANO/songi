import "../setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceProblem } from "../../src/lib/commerce/stripe";

const base = { id: "price_x", active: true, type: "one_time" as const, unit_amount: 7997, currency: "usd" };

test("STRIPE_PRICE_ID: sold only when it equals SONG_PRICE_CENTS, is one-time and active", () => {
  const was = process.env.SONG_PRICE_CENTS;
  process.env.SONG_PRICE_CENTS = "7997";
  try {
    assert.equal(priceProblem(base), null);
    assert.match(priceProblem({ ...base, unit_amount: 3900 })!, /SONG_PRICE_CENTS/);
    assert.match(priceProblem({ ...base, currency: "eur" })!, /SONG_PRICE_CENTS/);
    assert.match(priceProblem({ ...base, active: false })!, /archived/);
    assert.match(priceProblem({ ...base, type: "recurring" })!, /one-time/);
  } finally {
    if (was === undefined) delete process.env.SONG_PRICE_CENTS;
    else process.env.SONG_PRICE_CENTS = was;
  }
});

/**
 * The song's price, read from Stripe so it can be changed in the Dashboard without a deploy.
 *
 * Where the price comes from, first match wins:
 *   1. STRIPE_PRODUCT_ID: that product's DEFAULT price. Change the price in Stripe by adding a
 *      new price to the product and choosing "Set as default price".
 *   2. STRIPE_PRICE_ID: that one price, pinned.
 *   3. SONG_PRICE_CENTS / SONG_CURRENCY (also the fallback while Stripe can't be reached).
 *
 * Built not to break:
 *   - Pages read a cached copy (refreshed in the background after PRICE_FRESH_MS), so a slow or
 *     down Stripe never slows or breaks a page. The last good price is kept until a new one loads.
 *   - Stripe's product/price webhooks mark the copy stale at once (invalidateSongPrice).
 *   - Checkout re-reads the price when the copy is stale and refuses to sell a price that is
 *     archived, recurring or has no fixed amount. Each order stores the amount it was sold at,
 *     and payments are checked against that, so a price change mid-checkout is safe.
 */
import type Stripe from "stripe";
import { env } from "../env";
import { reportIssue } from "../observability";
import { stripe } from "./stripe";

export type SongPrice = {
  cents: number;
  currency: string;
  /** e.g. "$79.97" */
  label: string;
  /** The Stripe Price to sell; null when the price comes from SONG_PRICE_CENTS. */
  priceId: string | null;
  productId: string | null;
  productName: string | null;
  /** Whether tax is added on top (exclusive) or already included. */
  taxBehavior: "inclusive" | "exclusive";
  source: "stripe" | "settings";
};

/** How long a fetched price is used as-is before a background refresh. Webhooks refresh sooner. */
export const PRICE_FRESH_MS = 60_000;

export function formatPrice(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** The price from settings (no Stripe product configured, or Stripe not reachable yet). */
export function settingsPrice(): SongPrice {
  const cents = env.songPriceCents;
  const currency = env.currency;
  return { cents, currency, label: formatPrice(cents, currency), priceId: null, productId: null, productName: null, taxBehavior: env.stripe.taxBehavior, source: "settings" };
}

/** True when the price should come from Stripe. */
export function priceFromStripe(): boolean {
  return !!(env.stripe.secretKey && (env.stripe.productId || env.stripe.priceId));
}

type PriceLike = Pick<Stripe.Price, "id" | "active" | "type" | "unit_amount" | "currency"> & { billing_scheme?: Stripe.Price.BillingScheme | null };

/** Why a Stripe Price can't be sold as the song, or null when it can. */
export function stripePriceProblem(p: PriceLike): string | null {
  if (!p.active) return `price ${p.id} is archived.`;
  if (p.type !== "one_time") return `price ${p.id} is recurring; the song needs a one-time price.`;
  if (p.billing_scheme && p.billing_scheme !== "per_unit") return `price ${p.id} is tiered; the song needs a simple fixed price.`;
  if (p.unit_amount == null || p.unit_amount <= 0) return `price ${p.id} has no fixed amount (customer-chosen or zero).`;
  return null;
}

function toSongPrice(p: Stripe.Price, product: Stripe.Product | null): SongPrice {
  const cents = p.unit_amount!;
  const taxBehavior: "inclusive" | "exclusive" = p.tax_behavior === "inclusive" ? "inclusive" : p.tax_behavior === "exclusive" ? "exclusive" : env.stripe.taxBehavior;
  return {
    cents,
    currency: p.currency,
    label: formatPrice(cents, p.currency),
    priceId: p.id,
    productId: product?.id ?? (typeof p.product === "string" ? p.product : null),
    productName: product?.name ?? null,
    taxBehavior,
    source: "stripe",
  };
}

/** Read the configured price from Stripe. Throws with a plain reason when it can't be sold. */
async function fetchStripePrice(): Promise<SongPrice> {
  const { productId, priceId } = env.stripe;
  if (productId) {
    const product = await stripe().products.retrieve(productId, { expand: ["default_price"] });
    if (!product.active) throw new Error(`product ${productId} is archived.`);
    const p = product.default_price;
    if (!p || typeof p === "string") throw new Error(`product ${productId} has no default price. In Stripe, open the product and set one.`);
    const problem = stripePriceProblem(p);
    if (problem) throw new Error(`the default price of product ${productId}: ${problem}`);
    return toSongPrice(p, product);
  }
  const p = await stripe().prices.retrieve(priceId, { expand: ["product"] });
  const problem = stripePriceProblem(p);
  if (problem) throw new Error(problem);
  const product = p.product && typeof p.product !== "string" && !("deleted" in p.product && p.product.deleted) ? (p.product as Stripe.Product) : null;
  return toSongPrice(p, product);
}

let fetcher: () => Promise<SongPrice> = fetchStripePrice;
let cache: { price: SongPrice; at: number; key: string } | null = null;
let inflight: Promise<SongPrice> | null = null;
let lastProblem = "";

const configKey = () => `${env.stripe.productId}|${env.stripe.priceId}`;

function refresh(): Promise<SongPrice> {
  if (inflight) return inflight;
  const key = configKey();
  inflight = fetcher()
    .then((price) => {
      cache = { price, at: Date.now(), key };
      if (lastProblem) console.log(`[pricing] Price from Stripe is OK again: ${price.label} (${price.priceId}).`);
      lastProblem = "";
      return price;
    })
    .catch((e: Error) => {
      // Report each distinct problem once, not on every page view.
      if (e.message !== lastProblem) {
        lastProblem = e.message;
        reportIssue("Song price could not be read from Stripe", { kind: "pricing", error: e.message }, "error");
      }
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The price to show. Never throws and never waits on Stripe once a price has loaded: a stale
 * copy is returned while a fresh one loads in the background. Before the first successful
 * load (or with no Stripe product configured), the price from settings.
 */
export async function getSongPrice(): Promise<SongPrice> {
  if (!priceFromStripe()) return settingsPrice();
  const usable = cache && cache.key === configKey() ? cache : null;
  if (usable) {
    if (Date.now() - usable.at >= PRICE_FRESH_MS) refresh().catch(() => {});
    return usable.price;
  }
  try {
    return await refresh();
  } catch {
    return settingsPrice();
  }
}

/**
 * The price to sell at checkout. Uses the cached copy only while fresh; otherwise asks Stripe.
 * Throws when the configured price can't be sold (checkout then shows a friendly error).
 */
export async function getCheckoutPrice(): Promise<SongPrice> {
  if (!priceFromStripe()) return settingsPrice();
  if (cache && cache.key === configKey() && Date.now() - cache.at < PRICE_FRESH_MS) return cache.price;
  return refresh();
}

/** A product or price changed in Stripe: re-read it on the next request. */
export function invalidateSongPrice() {
  if (cache) cache.at = 0;
}

/** Load the price at startup so the first visitor doesn't wait for Stripe. */
export async function warmSongPrice(): Promise<void> {
  if (!priceFromStripe()) return;
  try {
    const p = await refresh();
    console.log(`[pricing] Song price from Stripe: ${p.label} (${p.productName ?? p.productId ?? "product"}, ${p.priceId}).`);
  } catch (e) {
    console.error(`[pricing] Couldn't read the song price from Stripe (${(e as Error).message}). Showing ${settingsPrice().label} from SONG_PRICE_CENTS until it can.`);
  }
}

/** Tests: replace the Stripe read and clear the cache. */
export function setPriceFetcherForTests(fn: (() => Promise<SongPrice>) | null) {
  fetcher = fn ?? fetchStripePrice;
  cache = null;
  inflight = null;
  lastProblem = "";
}

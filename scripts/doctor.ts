/**
 * Check your .env without spending anything and without printing secrets.
 *   npm run doctor            # check every provider
 *   npm run doctor -- --fix   # also generate local signing secrets if missing
 *
 * Calls made (all free, read-only): Anthropic model lookup, Kie.ai credit
 * balance, Stripe account and key modes.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { env, productionConfigProblems } from "../src/lib/env";
import { stripe } from "../src/lib/commerce/stripe";
import { checkBucket } from "../src/lib/storage";
import { MODEL_CAPS } from "../src/lib/songcraft/style";

type Level = "ok" | "warn" | "fail" | "info";
const icon: Record<Level, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL", info: "INFO" };
let failures = 0;
function out(level: Level, area: string, msg: string) {
  if (level === "fail") failures++;
  console.log(`${icon[level]}  ${area.padEnd(10)} ${msg}`);
}
const mask = (s: string) => (s ? `${s.slice(0, 4)}… (${s.length} chars)` : "(empty)");

function fixSecrets() {
  const file = path.join(process.cwd(), ".env");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const set = (key: string, value: string) => {
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
    process.env[key] = value;
  };
  if (!process.env.MEDIA_SIGNING_SECRET) {
    set("MEDIA_SIGNING_SECRET", crypto.randomBytes(32).toString("hex"));
    out("ok", "fix", "Generated MEDIA_SIGNING_SECRET in .env");
  }
  if (!process.env.ADMIN_TOKEN) {
    set("ADMIN_TOKEN", crypto.randomBytes(16).toString("hex"));
    out("ok", "fix", "Generated ADMIN_TOKEN in .env (opens /admin?token=...)");
  }
  if (!process.env.KIE_WEBHOOK_SECRET || process.env.KIE_WEBHOOK_SECRET === "change-me") {
    set("KIE_WEBHOOK_SECRET", crypto.randomBytes(24).toString("hex"));
    out("ok", "fix", "Generated KIE_WEBHOOK_SECRET in .env");
  }
  fs.writeFileSync(file, text);
}

async function checkAnthropic() {
  if (!env.anthropicApiKey) return out("info", "Claude", "No ANTHROPIC_API_KEY: lyrics run in mock mode (placeholder text).");
  if (process.env.MOCK_LLM === "1" || process.env.MOCK_LLM === "true") out("warn", "Claude", "Key is set but MOCK_LLM is on, so it won't be used.");
  if (process.env.ANTHROPIC_BASE_URL && !/^https:\/\/api\.anthropic\.com\/?$/.test(process.env.ANTHROPIC_BASE_URL)) out("warn", "Claude", `ANTHROPIC_BASE_URL is set in your environment (${process.env.ANTHROPIC_BASE_URL}); the SDK will send requests there.`);
  try {
    const m = await new Anthropic({ apiKey: env.anthropicApiKey }).models.retrieve(env.llmModel);
    out("ok", "Claude", `Key ${mask(env.anthropicApiKey)} works; model ${m.id} is available.`);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401) out("fail", "Claude", "Key was rejected (401). Check ANTHROPIC_API_KEY at console.anthropic.com > API keys.");
    else if (err.status === 404) out("fail", "Claude", `Key works but model "${env.llmModel}" was not found. Check LLM_MODEL.`);
    else out("fail", "Claude", `Could not reach Anthropic: ${err.message ?? e}`);
  }
}

async function checkKie() {
  if (!(env.kieAllowedModels.includes(env.kieModel) && MODEL_CAPS[env.kieModel])) out("fail", "Kie.ai", `KIE_MODEL "${env.kieModel}" is not in KIE_ALLOWED_MODELS (${env.kieAllowedModels.join(", ")}).`);
  if (!env.kieApiKey) return out("info", "Kie.ai", "No KIE_API_KEY: recordings run in mock mode (test tones, no spend).");
  if (process.env.MOCK_KIE === "1" || process.env.MOCK_KIE === "true") out("warn", "Kie.ai", "Key is set but MOCK_KIE is on, so it won't be used.");
  try {
    const res = await fetch("https://api.kie.ai/api/v1/chat/credit", { headers: { Authorization: `Bearer ${env.kieApiKey}` }, signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: number } | null;
    if (j?.code === 200 && typeof j.data === "number") {
      out("ok", "Kie.ai", `Key ${mask(env.kieApiKey)} works; ${j.data} credits remaining.`);
      if (j.data < 50) out("warn", "Kie.ai", "Credit balance is low; one song uses two or three generation tasks.");
    } else out("fail", "Kie.ai", `Key check failed: code ${j?.code ?? res.status} ${j?.msg ?? ""}. Check KIE_API_KEY at kie.ai > API keys.`);
  } catch (e) {
    out("fail", "Kie.ai", `Could not reach Kie.ai: ${(e as Error).message}`);
  }
  if (!process.env.KIE_WEBHOOK_SECRET || process.env.KIE_WEBHOOK_SECRET === "change-me") out("warn", "Kie.ai", "KIE_WEBHOOK_SECRET is not set or is the old default. Run `npm run doctor -- --fix` to generate one.");
  if (!env.kieWebhookHmacKey) out("info", "Kie.ai", "KIE_WEBHOOK_HMAC_KEY not set (optional locally; set it in production from kie.ai settings).");
  if (/localhost|127\.0\.0\.1/.test(env.appUrl)) out("info", "Kie.ai", "APP_URL is localhost, so Kie.ai can't call back. That's fine: the song page polls Kie.ai instead.");
}

async function checkStripe() {
  const s = env.stripe;
  out("info", "Stripe", `Song price: ${env.priceLabel} (SONG_PRICE_CENTS=${env.songPriceCents}, ${env.currency.toUpperCase()}).`);
  if (!env.stripeEnabled) out("info", "Stripe", "Switched OFF (STRIPE_ENABLED=false): checkout uses the test button, nothing is charged. Set STRIPE_ENABLED=true for real payments.");
  if (!s.secretKey && !s.publishableKey) return out("info", "Stripe", "Not configured: checkout uses the test button (no real payments).");
  const missing = [["STRIPE_SECRET_KEY", s.secretKey], ["STRIPE_PUBLISHABLE_KEY", s.publishableKey], ["STRIPE_WEBHOOK_SECRET", s.webhookSecret]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) out("fail", "Stripe", `Partly configured; missing ${missing.join(", ")}.`);
  const live = (k: string) => (k.includes("_live_") ? "live" : k.includes("_test_") ? "test" : "unknown");
  if (s.secretKey && s.publishableKey && live(s.secretKey) !== live(s.publishableKey)) out("fail", "Stripe", "Secret and publishable keys are from different modes (one test, one live).");
  if (s.webhookSecret && !s.webhookSecret.startsWith("whsec_")) out("fail", "Stripe", "STRIPE_WEBHOOK_SECRET should start with whsec_.");
  if (s.secretKey) {
    try {
      const acct = await stripe().accounts.retrieve(null);
      out("ok", "Stripe", `Key works for ${acct.settings?.dashboard?.display_name || acct.id} (${live(s.secretKey)} mode). Charges ${acct.charges_enabled ? "enabled" : "NOT enabled yet"}.`);
    } catch (e) {
      out("fail", "Stripe", `Secret key rejected: ${(e as Error).message}`);
    }
  }
  if (s.secretKey) await checkStripeTax();
  out("info", "Stripe", `Webhook endpoint to add in Stripe: ${env.appUrl}/api/webhooks/stripe (events: ${STRIPE_EVENTS.join(", ")}).`);
}

const STRIPE_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "payment_intent.payment_failed", "charge.refunded"];

/**
 * Stripe Tax collects nothing (and raises no error) without a head office address and an
 * active registration where the buyer is, so check both, then run a real calculation.
 */
async function checkStripeTax() {
  const s = env.stripe;
  const label = "Stripe Tax";
  try {
    const settings = await stripe().tax.settings.retrieve();
    const regs = (await stripe().tax.registrations.list({ status: "active", limit: 100 })).data;
    const where = regs.map((r) => (r.country === "US" ? `US-${(r.country_options as { us?: { state?: string } }).us?.state ?? "?"}` : r.country)).join(", ");
    if (!s.automaticTax) {
      out("info", label, `Off (STRIPE_AUTOMATIC_TAX). Stripe settings: ${settings.status}${settings.head_office ? "" : ", no head office address"}; ${regs.length} active registration(s)${where ? ` (${where})` : ""}.`);
      return;
    }
    if (settings.status !== "active") return out("fail", label, "STRIPE_AUTOMATIC_TAX is on but Stripe Tax is not active: add your head office address in Dashboard → Tax → Settings. Checkout will fail until then.");
    if (!regs.length) return out("fail", label, "STRIPE_AUTOMATIC_TAX is on but there are no active registrations, so NO tax is collected anywhere. Add the places you're registered in Dashboard → Tax → Registrations.");
    out("ok", label, `On. Tax code ${s.taxCode}, prices tax-${s.taxBehavior}. Collecting in: ${where}.`);
    // A real calculation for the first registration, to prove the setup end to end.
    const first = regs[0];
    const state = (first.country_options as { us?: { state?: string } }).us?.state;
    const sample = first.country === "US" ? SAMPLE_US[state ?? ""] : { country: first.country };
    if (!sample) return out("info", label, `No sample address for ${where.split(", ")[0]}; run a test checkout from that place to confirm tax.`);
    const calc = await stripe().tax.calculations.create({
      currency: env.currency,
      line_items: [{ amount: env.songPriceCents, reference: "song", tax_code: s.taxCode, tax_behavior: s.taxBehavior }],
      customer_details: { address: sample, address_source: "billing" },
    });
    const reasons = [...new Set(calc.tax_breakdown.map((b) => b.taxability_reason))].join(", ");
    if (reasons.includes("not_collecting")) out("fail", label, `Test calculation in ${where.split(", ")[0]} returned not_collecting: check the registration and tax code.`);
    else out("ok", label, `Test calculation in ${where.split(", ")[0]}: tax ${calc.tax_amount_exclusive + calc.tax_amount_inclusive} on ${env.songPriceCents} (${reasons}). Confirm with your tax advisor that this is expected.`);
  } catch (e) {
    out("warn", label, `Could not read tax settings: ${(e as Error).message}`);
  }
}

/** One real-looking address per common US registration state, for the test calculation. */
const SAMPLE_US: Record<string, { country: string; state: string; postal_code: string; city: string; line1: string }> = {
  CA: { country: "US", state: "CA", postal_code: "94103", city: "San Francisco", line1: "354 Oyster Point Blvd" },
  NY: { country: "US", state: "NY", postal_code: "10001", city: "New York", line1: "350 5th Ave" },
  TX: { country: "US", state: "TX", postal_code: "78701", city: "Austin", line1: "1100 Congress Ave" },
  WA: { country: "US", state: "WA", postal_code: "98101", city: "Seattle", line1: "400 Pine St" },
  FL: { country: "US", state: "FL", postal_code: "33131", city: "Miami", line1: "100 SE 2nd St" },
  PA: { country: "US", state: "PA", postal_code: "19103", city: "Philadelphia", line1: "1500 Market St" },
  IL: { country: "US", state: "IL", postal_code: "60601", city: "Chicago", line1: "233 S Wacker Dr" },
  NJ: { country: "US", state: "NJ", postal_code: "07102", city: "Newark", line1: "1 Gateway Center" },
};

async function checkPlatform() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
    if (r.status === 0) out("ok", "Audio", `${bin} found (${r.stdout.split("\n")[0].split(" ").slice(0, 3).join(" ")}).`);
    else out("fail", "Audio", `${bin} not found. Install ffmpeg (Mac: brew install ffmpeg).`);
  }
  if (!process.env.MEDIA_SIGNING_SECRET) out(env.isProd ? "fail" : "warn", "Media", "MEDIA_SIGNING_SECRET not set (a dev default is used locally). Run `npm run doctor -- --fix`.");
  else out("ok", "Media", `MEDIA_SIGNING_SECRET set ${mask(process.env.MEDIA_SIGNING_SECRET)}.`);
  // The same check a production server runs at startup (it refuses to start on any of these).
  for (const p of productionConfigProblems()) out("fail", "Production", p);
  if (env.turnstile.enabled) out("ok", "Bot check", "Cloudflare Turnstile is on for song creation.");
  else out(env.isProd ? "warn" : "info", "Bot check", "Turnstile is off: set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to require a bot check before a song is created.");
  if (env.email.enabled) out("ok", "Email", `Preview links are emailed through ${env.email.provider} from ${env.email.from}.`);
  else out("info", "Email", "Email is off: buyers keep their preview link with the copy and share buttons. Set EMAIL_FROM and POSTMARK_SERVER_TOKEN or RESEND_API_KEY to email it.");
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) out("ok", "Errors", "Sentry error tracking is on.");
  else out(env.isProd ? "warn" : "info", "Errors", "NEXT_PUBLIC_SENTRY_DSN not set: errors only go to the server log.");
  if (!process.env.ADMIN_TOKEN) out(env.isProd ? "fail" : "warn", "Admin", "ADMIN_TOKEN not set: /admin is open on this machine only (closed in production). Run `npm run doctor -- --fix`.");
  else out("ok", "Admin", "ADMIN_TOKEN set. Open /admin?token=<ADMIN_TOKEN> to see every test song and its feedback.");
  out("ok", "Writer", `Songwriter ${env.writerVersion}, ${env.lyricDrafts} first draft(s) per song.`);
  if (env.databaseUrl) {
    try {
      const postgres = (await import("postgres")).default;
      const sql = postgres(env.databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
      await sql`select 1`;
      await sql.end();
      out("ok", "Database", "Postgres connection works.");
    } catch (e) {
      out("fail", "Database", `Postgres connection failed: ${(e as Error).message}`);
    }
  } else out("info", "Database", "No DATABASE_URL: using the built-in local database in ./data.");
  await checkStorage();
  out("info", "Budget", `Up to ${env.desiredCandidates} versions per song, max ${env.maxTasksPerProject} tasks and ~$${env.maxEstSpendUsd.toFixed(2)} estimated generation spend per song.`);
}

async function checkStorage() {
  const r = await checkBucket();
  out(r.ok ? (env.storageDriver === "s3" ? "ok" : "info") : "fail", "Storage", env.storageDriver === "s3" ? r.message : `${r.message} Set STORAGE_DRIVER=s3 for Cloudflare R2.`);
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".env"))) {
    fs.copyFileSync(path.join(process.cwd(), ".env.example"), path.join(process.cwd(), ".env"));
    out("ok", "setup", "Created .env from .env.example.");
  }
  if (process.argv.includes("--fix")) fixSecrets();
  console.log(`\nMode: Claude ${env.mockLlm ? "MOCK" : "LIVE"} · Kie.ai ${env.mockKie ? "MOCK" : "LIVE"} · Payments ${env.mockPayments ? "TEST CHECKOUT" : "LIVE (Stripe)"}\n`);
  await checkAnthropic();
  await checkKie();
  await checkStripe();
  await checkPlatform();
  console.log(failures ? `\n${failures} problem(s) to fix.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

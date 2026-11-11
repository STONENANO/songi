/**
 * Check your .env without spending anything and without printing secrets.
 *   npm run doctor            # check every provider
 *   npm run doctor -- --fix   # also generate local signing secrets if missing
 *
 * Calls made (all free, read-only): Anthropic model lookup, Kie.ai credit
 * balance, Shopify Storefront shop + variant query, Shopify Admin shop query.
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../src/lib/env";
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
  if (env.kieWebhookSecret === "change-me") out("warn", "Kie.ai", "KIE_WEBHOOK_SECRET is the default. Run `npm run doctor -- --fix` to generate one.");
  if (!env.kieWebhookHmacKey) out("info", "Kie.ai", "KIE_WEBHOOK_HMAC_KEY not set (optional locally; set it in production from kie.ai settings).");
  if (/localhost|127\.0\.0\.1/.test(env.appUrl)) out("info", "Kie.ai", "APP_URL is localhost, so Kie.ai can't call back. That's fine: the song page polls Kie.ai instead.");
}

async function checkShopify() {
  const s = env.shopify;
  const any = s.storeDomain || s.storefrontToken || s.songVariantId || s.webhookSecret;
  if (!any) return out("info", "Shopify", "Not configured: checkout uses the local test page (no real payments).");
  const missing = [["SHOPIFY_STORE_DOMAIN", s.storeDomain], ["SHOPIFY_STOREFRONT_TOKEN", s.storefrontToken], ["SHOPIFY_SONG_VARIANT_ID", s.songVariantId], ["SHOPIFY_WEBHOOK_SECRET", s.webhookSecret]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) out("fail", "Shopify", `Partly configured; missing ${missing.join(", ")}. Until all are set, test checkout is used.`);
  if (s.songVariantId && !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s.songVariantId)) out("fail", "Shopify", "SHOPIFY_SONG_VARIANT_ID must look like gid://shopify/ProductVariant/123456789.");
  if (s.storeDomain && !/\.myshopify\.com$/.test(s.storeDomain)) out("warn", "Shopify", `SHOPIFY_STORE_DOMAIN should be your-store.myshopify.com (got ${s.storeDomain}).`);
  if (s.storeDomain && s.storefrontToken) {
    try {
      const res = await fetch(`https://${s.storeDomain}/api/${s.apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": s.storefrontToken },
        body: JSON.stringify({ query: `query($id: ID!) { shop { name } node(id: $id) { ... on ProductVariant { title availableForSale price { amount currencyCode } product { title } } } }`, variables: { id: s.songVariantId || "gid://shopify/ProductVariant/0" } }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await res.json().catch(() => null)) as { data?: { shop?: { name: string }; node?: { title: string; availableForSale: boolean; price: { amount: string; currencyCode: string }; product: { title: string } } | null }; errors?: { message: string }[] } | null;
      if (!res.ok || !j?.data?.shop) out("fail", "Shopify", `Storefront token rejected (HTTP ${res.status}). Check SHOPIFY_STOREFRONT_TOKEN and the store domain.`);
      else {
        out("ok", "Shopify", `Storefront works for "${j.data.shop.name}".`);
        const v = j.data.node;
        if (s.songVariantId && !v) out("fail", "Shopify", "Song variant not found or not published to the Storefront sales channel.");
        else if (v) {
          out(v.availableForSale ? "ok" : "fail", "Shopify", `Song product "${v.product.title} / ${v.title}" at ${v.price.amount} ${v.price.currencyCode}${v.availableForSale ? "" : " is NOT available for sale"}.`);
          if (!s.priceLabel.includes(String(Math.round(Number(v.price.amount))))) out("warn", "Shopify", `SONG_PRICE_LABEL (${s.priceLabel}) doesn't match the Shopify price. The label is display-only; checkout always charges Shopify's price.`);
        }
      }
    } catch (e) {
      out("fail", "Shopify", `Could not reach Shopify: ${(e as Error).message}`);
    }
  }
  if (s.adminToken && s.storeDomain) {
    const res = await fetch(`https://${s.storeDomain}/admin/api/${s.apiVersion}/shop.json`, { headers: { "X-Shopify-Access-Token": s.adminToken }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    out(res?.ok ? "ok" : "warn", "Shopify", res?.ok ? "Admin token works (orders will be double-checked)." : "Admin token rejected; orders will rely on the signed webhook only.");
  }
}

async function checkPlatform() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
    if (r.status === 0) out("ok", "Audio", `${bin} found (${r.stdout.split("\n")[0].split(" ").slice(0, 3).join(" ")}).`);
    else out("fail", "Audio", `${bin} not found. Install ffmpeg (Mac: brew install ffmpeg).`);
  }
  if (!process.env.MEDIA_SIGNING_SECRET) out(env.isProd ? "fail" : "warn", "Media", "MEDIA_SIGNING_SECRET not set (a dev default is used locally). Run `npm run doctor -- --fix`.");
  else out("ok", "Media", `MEDIA_SIGNING_SECRET set ${mask(process.env.MEDIA_SIGNING_SECRET)}.`);
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
  out("info", "Budget", `Up to ${env.desiredCandidates} versions per song, max ${env.maxTasksPerProject} tasks and ~$${env.maxEstSpendUsd.toFixed(2)} estimated generation spend per song.`);
}

async function main() {
  if (!fs.existsSync(path.join(process.cwd(), ".env"))) {
    fs.copyFileSync(path.join(process.cwd(), ".env.example"), path.join(process.cwd(), ".env"));
    out("ok", "setup", "Created .env from .env.example.");
  }
  if (process.argv.includes("--fix")) fixSecrets();
  console.log(`\nMode: Claude ${env.mockLlm ? "MOCK" : "LIVE"} · Kie.ai ${env.mockKie ? "MOCK" : "LIVE"} · Shopify ${env.mockShopify ? "TEST CHECKOUT" : "LIVE"}\n`);
  await checkAnthropic();
  await checkKie();
  await checkShopify();
  await checkPlatform();
  console.log(failures ? `\n${failures} problem(s) to fix.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

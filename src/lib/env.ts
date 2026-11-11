/**
 * Central, typed access to environment configuration.
 * Mock modes switch on automatically when the matching credentials are missing,
 * so a fresh clone runs end-to-end with zero credentials and zero spend.
 */
export type WriterVersion = "v1" | "v2" | "v3";
function flag(v: string | undefined, dflt = false): boolean {
  if (v === undefined || v === "") return dflt;
  return v === "1" || v === "true" || v === "yes";
}
function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : dflt;
}
function list(v: string | undefined, dflt: string[]): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : dflt;
}

export const env = {
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get appUrl(): string {
    return (process.env.APP_URL ?? "http://localhost:4747").replace(/\/$/, "");
  },

  /* ---------------- Claude ---------------- */
  get anthropicApiKey(): string {
    return process.env.ANTHROPIC_API_KEY ?? "";
  },
  get llmModel(): string {
    return process.env.LLM_MODEL ?? "claude-opus-5-5";
  },
  get mockLlm(): boolean {
    return flag(process.env.MOCK_LLM) || !this.anthropicApiKey;
  },
  /** Server-side refusal fallback (beta) so a safety decline is retried on a fallback model. */
  get llmRefusalFallback(): boolean {
    return flag(process.env.LLM_REFUSAL_FALLBACK, true);
  },
  /** Estimated $ per million tokens, for cost reporting only. Actual charges come from your Anthropic invoice. */
  get llmInputCostPerMTok(): number {
    return num(process.env.LLM_INPUT_COST_PER_MTOK, 4);
  },
  get llmOutputCostPerMTok(): number {
    return num(process.env.LLM_OUTPUT_COST_PER_MTOK, 20);
  },

  /* ---------------- Songcraft ---------------- */
  /** "v3" (default, idea-first writer), "v2" or "v1" (earlier writers, kept for A/B tests). */
  get writerVersion(): WriterVersion {
    const v = process.env.SONGCRAFT_WRITER;
    return v === "v1" || v === "v2" ? v : "v3";
  },
  /** First drafts written per song (in parallel); the best verified one is kept. 1 or 2. */
  get lyricDrafts(): number {
    return Math.max(1, Math.min(2, num(process.env.LYRIC_DRAFTS, 2)));
  },
  /** Opens /admin. Required in production; optional locally. */
  get adminToken(): string {
    return process.env.ADMIN_TOKEN ?? "";
  },
  /** Automatic lyric repair passes after the first draft. */
  get lyricMaxRepairs(): number {
    return Math.max(0, Math.min(2, num(process.env.LYRIC_MAX_REPAIRS, 1)));
  },
  /** Run a craft-only repair when the weighted creative score (1-10) is below this. 0 disables. */
  get lyricCraftRepairBelow(): number {
    return num(process.env.LYRIC_CRAFT_REPAIR_BELOW, 5);
  },
  /** Also polish when the verifier's singability score (1-10) is below this, whatever the overall score. 0 disables. */
  get lyricPolishSingabilityBelow(): number {
    return num(process.env.LYRIC_POLISH_SINGABILITY_BELOW, 7);
  },
  /** At most this many must-use (priority-1) facts; the rest become priority 2. */
  get briefMaxPriority1(): number {
    return num(process.env.BRIEF_MAX_PRIORITY1, 3);
  },
  get briefFactCap(): number {
    return num(process.env.BRIEF_FACT_CAP, 12);
  },

  /* ---------------- Kie.ai / Suno ---------------- */
  get kieApiKey(): string {
    return process.env.KIE_API_KEY ?? "";
  },
  get kieModel(): string {
    return process.env.KIE_MODEL ?? "V6";
  },
  get kieAllowedModels(): string[] {
    return list(process.env.KIE_ALLOWED_MODELS, ["V6", "V6_MINI", "V6_WILD"]);
  },
  get mockKie(): boolean {
    return flag(process.env.MOCK_KIE) || !this.kieApiKey;
  },
  /** Shared secret used to sign our own callback URLs (per generation). */
  get kieWebhookSecret(): string {
    return process.env.KIE_WEBHOOK_SECRET ?? "change-me";
  },
  /** Kie.ai's webhookHmacKey (Settings page). When set, callbacks must carry a valid X-Webhook-Signature. */
  get kieWebhookHmacKey(): string {
    return process.env.KIE_WEBHOOK_HMAC_KEY ?? "";
  },
  /** Optional allowlist of audio download hosts. Empty = any public https host. */
  get kieAudioHosts(): string[] {
    return list(process.env.KIE_AUDIO_HOSTS, []);
  },
  get mockKieDelayMs(): number {
    return num(process.env.MOCK_KIE_DELAY_MS, 6000);
  },

  /* ---------------- Candidate generation budget ---------------- */
  get desiredCandidates(): number {
    return Math.max(1, Math.min(3, num(process.env.DESIRED_CANDIDATES, 3)));
  },
  get minCandidates(): number {
    return Math.max(1, num(process.env.MIN_CANDIDATES, 1));
  },
  /** Tasks the pipeline may submit on its own for one lyric draft. */
  get maxAutoTasks(): number {
    return Math.max(1, num(process.env.MAX_AUTO_TASKS, 3));
  },
  /** Hard cap on tasks per song project, including customer-requested extra takes. */
  get maxTasksPerProject(): number {
    return Math.max(1, num(process.env.MAX_TASKS_PER_PROJECT, 5));
  },
  get maxEstSpendUsd(): number {
    return num(process.env.MAX_EST_SPEND_USD, 0.75);
  },
  /** Estimated Kie cost of one generation task (two tracks). Configurable estimate, not an actual charge. */
  get kieTaskCostUsd(): number {
    return num(process.env.KIE_TASK_COST_USD, 0.065);
  },
  get expectedTracksPerTask(): number {
    return Math.max(1, num(process.env.EXPECTED_TRACKS_PER_TASK, 2));
  },
  get taskTimeoutMs(): number {
    return num(process.env.TASK_TIMEOUT_MS, 15 * 60_000);
  },
  /** "distinct" = each task uses a different musical archetype; "same_style" = every task uses the signature style. */
  get variantMode(): "distinct" | "same_style" {
    return process.env.VARIANT_MODE === "same_style" ? "same_style" : "distinct";
  },
  /** "per_task" = pick the best track from each task (one task per offered version). "collect" = keep every usable track. */
  get candidateCollection(): "collect" | "per_task" {
    return process.env.CANDIDATE_COLLECTION === "per_task" ? "per_task" : "collect";
  },
  get randomizeCandidateOrder(): boolean {
    return flag(process.env.RANDOMIZE_CANDIDATE_ORDER, true);
  },

  /* ---------------- Media ---------------- */
  get mediaSigningSecret(): string {
    const s = process.env.MEDIA_SIGNING_SECRET ?? "";
    if (!s && this.isProd) throw new Error("MEDIA_SIGNING_SECRET must be set in production.");
    return s || "dev-only-media-secret";
  },
  get previewSeconds(): number {
    return Math.max(20, Math.min(90, num(process.env.PREVIEW_SECONDS, 45)));
  },
  get previewUrlTtlSec(): number {
    return num(process.env.PREVIEW_URL_TTL_SEC, 3600);
  },
  get downloadUrlTtlSec(): number {
    return num(process.env.DOWNLOAD_URL_TTL_SEC, 900);
  },
  get minLyricCoverage(): number {
    return num(process.env.MIN_LYRIC_COVERAGE, 0.6);
  },

  /* ---------------- Database / storage ---------------- */
  get databaseUrl(): string {
    return process.env.DATABASE_URL ?? "";
  },
  get pgliteDataDir(): string {
    return process.env.PGLITE_DATA_DIR ?? "";
  },
  get storageDriver(): "local" | "s3" {
    return (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3";
  },
  get storageLocalDir(): string {
    return process.env.STORAGE_LOCAL_DIR ?? "";
  },
  get s3() {
    return {
      bucket: process.env.S3_BUCKET ?? "",
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT ?? "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    };
  },

  /* ---------------- Shopify ---------------- */
  get shopify() {
    return {
      storeDomain: (process.env.SHOPIFY_STORE_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
      storefrontToken: process.env.SHOPIFY_STOREFRONT_TOKEN ?? "",
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-10",
      /** gid://shopify/ProductVariant/<n> of the "Custom song" product. */
      songVariantId: process.env.SHOPIFY_SONG_VARIANT_ID ?? "",
      webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET ?? "",
      adminToken: process.env.SHOPIFY_ADMIN_TOKEN ?? "",
      priceLabel: process.env.SONG_PRICE_LABEL ?? "$39",
    };
  },
  get mockShopify(): boolean {
    const s = this.shopify;
    return flag(process.env.MOCK_SHOPIFY) || !s.storeDomain || !s.storefrontToken || !s.songVariantId;
  },
  /** Secret used to sign simulated webhooks in mock mode (never used when real Shopify is configured). */
  mockShopifyWebhookSecret: "mock-shopify-webhook-secret",
};

export function assertSafeForProduction(): void {
  if (!env.isProd) return;
  if (env.kieWebhookSecret === "change-me") throw new Error("KIE_WEBHOOK_SECRET must be changed in production.");
  void env.mediaSigningSecret;
}

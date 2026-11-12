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
  /** Fast model for the in-quiz follow-up questions. Latency matters more than depth here. */
  get probeModel(): string {
    return process.env.PROBE_MODEL ?? "claude-haiku-5-5";
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

  /* ---------------- Payments (Stripe) ---------------- */
  get stripe() {
    return {
      secretKey: process.env.STRIPE_SECRET_KEY ?? "",
      /** Sent to the browser for the Payment Element; safe to expose. */
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
      /** whsec_... from the webhook endpoint (or `stripe listen` locally). */
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
      /**
       * Stripe Tax on the checkout (automatic_tax). Off until Tax is set up in Stripe:
       * a head office address and at least one active registration. Without a registration,
       * Stripe silently collects no tax, so `npm run doctor` checks both.
       */
      automaticTax: flag(process.env.STRIPE_AUTOMATIC_TAX),
      /** Product tax code for the song. Default: Digital Audio Works, downloaded, permanent rights. Confirm with your tax advisor. */
      taxCode: process.env.STRIPE_TAX_CODE || "txcd_10401100",
      /** exclusive = tax is added on top of the price (usual in the US); inclusive = the price already contains tax. */
      taxBehavior: (process.env.STRIPE_TAX_BEHAVIOR === "inclusive" ? "inclusive" : "exclusive") as "inclusive" | "exclusive",
    };
  },
  /** The song's price in the smallest currency unit. Set on the server only; the browser never sends a price. */
  get songPriceCents(): number {
    return num(process.env.SONG_PRICE_CENTS, 3900);
  },
  get currency(): string {
    return (process.env.SONG_CURRENCY ?? "usd").toLowerCase();
  },
  /** Shown on buttons and the checkout page, derived from the real price. */
  get priceLabel(): string {
    const amount = this.songPriceCents / 100;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: this.currency.toUpperCase(), minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  },
  /**
   * The Stripe switch. Off (the default) = checkout uses the test button and nothing is
   * charged, even with Stripe keys in place, so the quiz and song generation can be tested
   * freely. On = real payments, once the keys are set too.
   */
  get stripeEnabled(): boolean {
    return flag(process.env.STRIPE_ENABLED);
  },
  /** Test checkout instead of Stripe: the switch is off, keys are missing, or MOCK_PAYMENTS is set. */
  get mockPayments(): boolean {
    const s = this.stripe;
    return flag(process.env.MOCK_PAYMENTS) || !this.stripeEnabled || !s.secretKey || !s.publishableKey;
  },
  /**
   * Test phase on a live server: Stripe is off, so the checkout step unlocks the
   * song for free. Only meaningful while Stripe is off or not configured.
   */
  get freeDownloads(): boolean {
    return flag(process.env.FREE_DOWNLOADS) && this.mockPayments;
  },
  /** The test checkout works locally, and on a live server only in free-download mode. */
  get testCheckoutAllowed(): boolean {
    return this.mockPayments && (!this.isProd || this.freeDownloads);
  },
  /** Site-wide cap on new songs per rolling 24 hours (protects the API bill). 0 = no cap. */
  get maxSongsPerDay(): number {
    return num(process.env.MAX_SONGS_PER_DAY, 40);
  },
};

export function assertSafeForProduction(): void {
  if (!env.isProd) return;
  if (env.kieWebhookSecret === "change-me") throw new Error("KIE_WEBHOOK_SECRET must be changed in production.");
  // Live payments without a webhook secret would still unlock via the return page, but refunds and
  // late confirmations would be missed: refuse to start half-configured.
  if (!env.mockPayments && !env.stripe.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET must be set when STRIPE_ENABLED is on.");
  if (env.storageDriver === "s3") {
    const missing = (["bucket", "endpoint", "accessKeyId", "secretAccessKey"] as const).filter((k) => !env.s3[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (missing: ${missing.join(", ")}).`);
  }
  void env.mediaSigningSecret;
}

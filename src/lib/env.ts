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

/** Values copied from .env.example or docs that must never sign anything in production. */
const PLACEHOLDER_SECRETS = new Set(["change-me", "changeme", "secret", "dev-only-media-secret", "dev-only-kie-secret"]);

export const env = {
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get appUrl(): string {
    return (process.env.APP_URL ?? "http://localhost:4747").replace(/\/$/, "");
  },

  /* ---------------- PostHog (product analytics) ---------------- */
  /** Project API key (phc_...). Public by design: the browser sends it with every event. Empty = analytics off. */
  get posthogKey(): string {
    return process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
  },
  /** https://us.i.posthog.com (US cloud) or https://eu.i.posthog.com (EU cloud). */
  get posthogHost(): string {
    return (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
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
  /** Opens the admin API (GET /api/admin/ip). The /admin pages use the Supabase sign-in below instead. */
  get adminToken(): string {
    return process.env.ADMIN_TOKEN ?? "";
  },

  /* ---------------- Admin sign-in (Supabase Auth) ---------------- */
  /** Supabase project URL (https://<ref>.supabase.co). Only its Auth is used, for the /admin sign-in. */
  get supabaseUrl(): string {
    return (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  },
  /** The project's publishable key (sb_publishable_...) or legacy anon key. Public by design. */
  get supabasePublishableKey(): string {
    return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  },
  /**
   * How admins sign in. email (default): Supabase emails a one-time sign-in link, no other setup.
   * google / github: that provider must be enabled in Supabase -> Authentication -> Sign In / Providers.
   */
  get adminAuthProvider(): "email" | "google" | "github" {
    const v = process.env.ADMIN_AUTH_PROVIDER;
    return v === "google" || v === "github" ? v : "email";
  },
  /** The only accounts allowed into /admin (comma-separated, any case). Empty = nobody. */
  get adminEmails(): string[] {
    return list(process.env.ADMIN_EMAILS, []).map((e) => e.toLowerCase());
  },
  get adminLoginConfigured(): boolean {
    return !!(this.supabaseUrl && this.supabasePublishableKey);
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
  /**
   * Shared secret used to sign our own callback URLs (per generation). Required in production,
   * where a missing or placeholder value would let anyone forge callbacks; a fixed value locally.
   */
  get kieWebhookSecret(): string {
    const s = process.env.KIE_WEBHOOK_SECRET ?? "";
    if (this.isProd && (!s || PLACEHOLDER_SECRETS.has(s))) throw new Error("KIE_WEBHOOK_SECRET must be set to a random value in production.");
    return s || "dev-only-kie-secret";
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
      /**
       * The Stripe Price (price_...) the checkout sells, so sales are recorded against your
       * product in Stripe. Its amount and currency must equal SONG_PRICE_CENTS / SONG_CURRENCY:
       * checkout refuses to open otherwise. Sandbox and live mode have different price ids.
       * Empty = an inline price built from SONG_PRICE_CENTS (no product in Stripe).
       */
      priceId: (process.env.STRIPE_PRICE_ID ?? "").trim(),
    };
  },
  /** The song's price in the smallest currency unit. Set on the server only; the browser never sends a price. */
  get songPriceCents(): number {
    return num(process.env.SONG_PRICE_CENTS, 3900);
  },
  /** Stripe's fee, for the margin estimates in /admin/numbers (US cards: 2.9% + 30¢). Check your Stripe pricing. */
  get stripeFee(): { percent: number; fixedCents: number } {
    return { percent: num(process.env.STRIPE_FEE_PERCENT, 2.9), fixedCents: num(process.env.STRIPE_FEE_FIXED_CENTS, 30) };
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
  /**
   * Optional site-wide cap on new songs per rolling 24 hours. 0 (the default) = no cap.
   * Added for the open test site; per-visitor, per-email and bot checks now do this job.
   */
  get maxSongsPerDay(): number {
    return num(process.env.MAX_SONGS_PER_DAY, 0);
  },
  /** Report (Sentry) when new songs in 24 hours reach this, and each multiple of it. 0 = off. */
  get songVolumeAlertPerDay(): number {
    return num(process.env.SONG_VOLUME_ALERT_PER_DAY, 100);
  },
  /** Songs one email address may start per rolling 7 days. 0 = no limit. */
  get maxSongsPerEmailPerWeek(): number {
    return num(process.env.MAX_SONGS_PER_EMAIL_PER_WEEK, 3);
  },

  /* ---------------- Preview links and retention ---------------- */
  /** How long the direct preview link works, from when the versions are ready. */
  get previewLinkHours(): number {
    return Math.max(1, num(process.env.PREVIEW_LINK_HOURS, 48));
  },
  /** Days after the versions are ready before unpurchased audio is deleted. Paid songs are kept. */
  get previewRetentionDays(): number {
    return Math.max(1, num(process.env.PREVIEW_RETENTION_DAYS, 14));
  },

  /* ---------------- Email (preview links) ---------------- */
  /** Transactional email: Postmark (POSTMARK_SERVER_TOKEN) or Resend (RESEND_API_KEY), from EMAIL_FROM. Off until set. */
  get email() {
    const postmark = process.env.POSTMARK_SERVER_TOKEN ?? "";
    const resend = process.env.RESEND_API_KEY ?? "";
    const from = process.env.EMAIL_FROM ?? "";
    const provider = postmark ? ("postmark" as const) : resend ? ("resend" as const) : null;
    return { provider, postmark, resend, from, enabled: !!provider && !!from };
  },

  /** Customer support address, shown in the site footer, legal pages and the purchase email. */
  get supportEmail(): string {
    return (process.env.SUPPORT_EMAIL ?? "").trim();
  },

  /* ---------------- Abuse and spend control ---------------- */
  /**
   * Header that carries the visitor's IP, set by our host's proxy (never by the visitor).
   * Railway's edge sets X-Real-IP, so that is the default on Railway. Elsewhere, empty:
   * the last X-Forwarded-For entry is used.
   */
  get clientIpHeader(): string {
    const v = process.env.CLIENT_IP_HEADER;
    if (v !== undefined) return v.trim().toLowerCase();
    return process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID ? "x-real-ip" : "";
  },
  /**
   * Cloudflare Turnstile bot check on "Write the song". On only when both keys are set.
   * The site key is public (shown in the page); the secret key verifies tokens server-side.
   */
  get turnstile() {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
    const secretKey = process.env.TURNSTILE_SECRET_KEY ?? "";
    return { siteKey, secretKey, enabled: !!siteKey && !!secretKey };
  },
  /** Lyric rewrites (regenerate or hand edit) one song may ask for, ever. Counted in the database. */
  get maxLyricRewrites(): number {
    return Math.max(0, num(process.env.MAX_LYRIC_REWRITES, 6));
  },
  /** Estimated Claude spend one song may reach before rewrites stop (first lyrics are never blocked). */
  get maxLlmUsdPerSong(): number {
    return num(process.env.MAX_LLM_USD_PER_SONG, 5);
  },
  /** Site-wide in-quiz follow-up questions per 24 hours; past it, the free rule-based version answers. */
  get maxProbesPerDay(): number {
    return num(process.env.MAX_PROBES_PER_DAY, 3000);
  },
};

/**
 * Everything that must be set before a production server may take traffic. Empty outside
 * production. Each entry is a sentence naming the setting, never its value.
 */
export function productionConfigProblems(): string[] {
  if (!env.isProd) return [];
  const problems: string[] = [];
  const set = (k: string) => !!process.env[k]?.trim();
  const placeholder = (k: string) => PLACEHOLDER_SECRETS.has(process.env[k]?.trim() ?? "");

  // Signs preview, download and delivery links: without it every link is forgeable or broken.
  if (!set("MEDIA_SIGNING_SECRET") || placeholder("MEDIA_SIGNING_SECRET")) problems.push("MEDIA_SIGNING_SECRET must be set to a long random value.");
  // Signs our Kie callback URLs; the old default "change-me" is public.
  if (!set("KIE_WEBHOOK_SECRET") || placeholder("KIE_WEBHOOK_SECRET")) problems.push("KIE_WEBHOOK_SECRET must be set to a long random value (not change-me).");
  // With real Kie calls, also require Kie's own signature on every callback.
  if (!env.mockKie && !set("KIE_WEBHOOK_HMAC_KEY")) problems.push("KIE_WEBHOOK_HMAC_KEY must be set (kie.ai > Settings > webhookHmacKey) when KIE_API_KEY is set.");
  if (env.stripeEnabled && !flag(process.env.MOCK_PAYMENTS)) {
    // The switch is on but the keys are missing: checkout would silently fall back to the test button.
    const missing = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"].filter((k) => !set(k) && !(k === "STRIPE_PUBLISHABLE_KEY" && set("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")));
    // Without the webhook secret, refunds and late payment confirmations are never processed.
    if (missing.length) problems.push(`STRIPE_ENABLED is on but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not set.`);
  }
  // An email key without a sender (or the reverse) would silently send nothing.
  if ((set("POSTMARK_SERVER_TOKEN") || set("RESEND_API_KEY")) !== set("EMAIL_FROM")) problems.push("Email needs EMAIL_FROM and one of POSTMARK_SERVER_TOKEN or RESEND_API_KEY (or none of them).");
  // Half a Turnstile setup means no bot check at all: say so instead of running unprotected.
  if (set("NEXT_PUBLIC_TURNSTILE_SITE_KEY") !== set("TURNSTILE_SECRET_KEY")) problems.push("Turnstile needs both NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY (or neither).");
  // A half-configured admin sign-in would lock everyone out of /admin without saying why.
  const adminLogin = [set("SUPABASE_URL"), !!env.supabasePublishableKey, set("ADMIN_EMAILS")];
  if (adminLogin.some(Boolean) && !adminLogin.every(Boolean)) problems.push("The /admin sign-in needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ADMIN_EMAILS (or none of them).");
  if (env.storageDriver === "s3") {
    const missing = ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !set(k));
    if (missing.length) problems.push(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}.`);
  }
  return problems;
}

/** Refuse to run a production server that is missing a required secret. Called once at startup. */
export function assertSafeForProduction(): void {
  const problems = productionConfigProblems();
  if (problems.length) throw new Error(`Refusing to start: production settings are missing.\n- ${problems.join("\n- ")}`);
}

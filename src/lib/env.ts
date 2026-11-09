/**
 * Central, typed access to environment configuration.
 * Mock modes switch on automatically when the matching API key is missing,
 * so a fresh clone runs end-to-end with zero credentials.
 */
function flag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export const env = {
  appUrl: (process.env.APP_URL ?? "http://localhost:4747").replace(/\/$/, ""),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "claude-opus-5-5",
  get mockLlm(): boolean {
    return flag(process.env.MOCK_LLM) || !this.anthropicApiKey;
  },

  kieApiKey: process.env.KIE_API_KEY ?? "",
  kieModel: process.env.KIE_MODEL ?? "V6",
  kieWebhookSecret: process.env.KIE_WEBHOOK_SECRET ?? "change-me",
  get mockKie(): boolean {
    return flag(process.env.MOCK_KIE) || !this.kieApiKey;
  },

  databaseUrl: process.env.DATABASE_URL ?? "",

  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3",
  s3: {
    bucket: process.env.S3_BUCKET ?? "",
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT ?? "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  },

  previewSeconds: Number(process.env.PREVIEW_SECONDS ?? 45),
  minLyricCoverage: Number(process.env.MIN_LYRIC_COVERAGE ?? 0.6),
  maxGenerationAttempts: Number(process.env.MAX_GENERATION_ATTEMPTS ?? 2),
};

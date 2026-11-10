import { pgTable, uuid, text, timestamp, jsonb, integer, real, boolean, serial, numeric } from "drizzle-orm/pg-core";

/** Lifecycle of one song project. Every transition is a pipeline step. */
export const REQUEST_STATUSES = [
  "draft",
  "briefing",
  "needs_input",
  "writing_lyrics",
  "lyrics_ready",
  "generating",
  "processing",
  "preview_ready",
  "purchased",
  "failed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Lyric draft gate. null = legacy draft written before v2 (gated by its stored verifier report). */
export type DraftStatus = "verified" | "needs_repair" | "failed" | "superseded";
export type GenerationStatus = "pending" | "submitted" | "unknown" | "collecting" | "complete" | "failed";
export type PurchaseStatus = "none" | "pending" | "paid" | "refunded";
export type OrderStatus = "pending" | "paid" | "refunded" | "cancelled" | "duplicate_payment" | "paid_unfulfilled";

export const songRequests = pgTable("song_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").$type<RequestStatus>().default("draft").notNull(),
  email: text("email"),

  recipientName: text("recipient_name"),
  pronunciation: text("pronunciation"),
  relationship: text("relationship").notNull(),
  occasion: text("occasion").notNull(),
  story: text("story").notNull(),
  genreKey: text("genre_key").notNull(),
  vocalGender: text("vocal_gender").$type<"m" | "f" | "any">().default("any").notNull(),
  mood: text("mood"),
  customStyle: text("custom_style"),
  language: text("language").default("en").notNull(),

  brief: jsonb("brief").$type<Record<string, unknown> | null>(),
  followUpQuestions: jsonb("follow_up_questions").$type<string[] | null>(),
  followUpAnswers: jsonb("follow_up_answers").$type<Record<string, string> | null>(),

  generationAttempts: integer("generation_attempts").default(0).notNull(),
  lastError: text("last_error"),

  // v2
  accessTokenHash: text("access_token_hash"),
  quizSnapshot: jsonb("quiz_snapshot").$type<Record<string, unknown> | null>(),
  briefVersion: integer("brief_version"),
  experiment: jsonb("experiment").$type<Record<string, unknown> | null>(),
  activeDraftId: uuid("active_draft_id"),
  selectedVersionId: uuid("selected_version_id"),
  candidatesFinalizedAt: timestamp("candidates_finalized_at", { withTimezone: true }),
});

export const lyricDrafts = pgTable("lyric_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => songRequests.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  displayLyrics: text("display_lyrics").notNull(),
  sungLyrics: text("sung_lyrics").notNull(),
  verifierReport: jsonb("verifier_report").$type<Record<string, unknown> | null>(),
  source: text("source").$type<"generated" | "regenerated" | "edited" | "mock" | "repair" | "shorten">().notNull(),
  approved: boolean("approved").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // v2
  status: text("status").$type<DraftStatus | null>(),
  validation: jsonb("validation").$type<Record<string, unknown> | null>(),
  creative: jsonb("creative").$type<Record<string, unknown> | null>(),
  arrangementId: text("arrangement_id"),
  plan: jsonb("plan").$type<Record<string, unknown> | null>(),
  factPlacement: jsonb("fact_placement").$type<{ factId: string; line: string }[] | null>(),
  promptVersion: text("prompt_version"),
  parentDraftId: uuid("parent_draft_id"),
});

export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => songRequests.id, { onDelete: "cascade" }),
  lyricDraftId: uuid("lyric_draft_id").notNull().references(() => lyricDrafts.id),
  provider: text("provider").default("kie-suno").notNull(),
  providerTaskId: text("provider_task_id"),
  registryVersion: text("registry_version").notNull(),
  requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<GenerationStatus>().default("submitted").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // v2
  idempotencyKey: text("idempotency_key"),
  slot: integer("slot"),
  trigger: text("trigger").$type<"auto" | "customer" | "retry">(),
  model: text("model"),
  variantId: text("variant_id"),
  promptVersion: text("prompt_version"),
  presetVersion: text("preset_version"),
  musicDirection: jsonb("music_direction").$type<Record<string, unknown> | null>(),
  estCostUsd: numeric("est_cost_usd", { precision: 10, scale: 4 }),
  creditsConsumed: real("credits_consumed"),
  trackCount: integer("track_count"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const songVersions = pgTable("song_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  generationId: uuid("generation_id").notNull().references(() => generations.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull().references(() => songRequests.id, { onDelete: "cascade" }),
  providerAudioId: text("provider_audio_id").notNull(),
  title: text("title"),
  audioKey: text("audio_key"),
  previewKey: text("preview_key"),
  imageUrl: text("image_url"),
  duration: real("duration"),
  previewStart: real("preview_start"),
  alignedWords: jsonb("aligned_words").$type<AlignedWord[] | null>(),
  quality: jsonb("quality").$type<Record<string, unknown> | null>(),
  status: text("status").$type<"pending" | "ready" | "rejected">().default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // v2
  variantId: text("variant_id"),
  variantLabel: text("variant_label"),
  styleSummary: text("style_summary"),
  requestedDuration: real("requested_duration"),
  sourceAudioUrl: text("source_audio_url"),
  audioQa: jsonb("audio_qa").$type<Record<string, unknown> | null>(),
  nameHeard: boolean("name_heard"),
  score: real("score"),
  offered: boolean("offered").default(false).notNull(),
  offerRank: integer("offer_rank"),
  selected: boolean("selected").default(false).notNull(),
  purchaseStatus: text("purchase_status").$type<PurchaseStatus>().default("none").notNull(),
  availability: text("availability").$type<"available" | "unavailable">().default("available").notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => songRequests.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull().references(() => songVersions.id),
  status: text("status").$type<OrderStatus>().default("pending").notNull(),
  offerId: text("offer_id"),
  cartId: text("cart_id"),
  checkoutUrl: text("checkout_url"),
  shopifyOrderId: text("shopify_order_id"),
  amountCents: integer("amount_cents"),
  currency: text("currency"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
});

export const webhookReceipts = pgTable("webhook_receipts", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  topic: text("topic"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  requestId: uuid("request_id").references(() => songRequests.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const costLedger = pgTable("cost_ledger", {
  id: serial("id").primaryKey(),
  requestId: uuid("request_id").references(() => songRequests.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  units: real("units").default(1).notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AlignedWord = { word: string; startS: number; endS: number; success: boolean };
export type SongRequest = typeof songRequests.$inferSelect;
export type LyricDraft = typeof lyricDrafts.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type SongVersion = typeof songVersions.$inferSelect;
export type Order = typeof orders.$inferSelect;

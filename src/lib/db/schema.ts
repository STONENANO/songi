import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  boolean,
  serial,
  numeric,
} from "drizzle-orm/pg-core";

/** Lifecycle of one song request. Every transition is a pipeline job. */
export const REQUEST_STATUSES = [
  "draft",
  "briefing",
  "needs_input",
  "writing_lyrics",
  "lyrics_ready",
  "generating",
  "processing",
  "preview_ready",
  "failed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const songRequests = pgTable("song_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  status: text("status").$type<RequestStatus>().default("draft").notNull(),
  email: text("email"),

  // Raw quiz answers
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

  // Agentic brief
  brief: jsonb("brief").$type<Record<string, unknown> | null>(),
  followUpQuestions: jsonb("follow_up_questions").$type<string[] | null>(),
  followUpAnswers: jsonb("follow_up_answers").$type<Record<string, string> | null>(),

  // Bookkeeping
  generationAttempts: integer("generation_attempts").default(0).notNull(),
  lastError: text("last_error"),
});

export const lyricDrafts = pgTable("lyric_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => songRequests.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  displayLyrics: text("display_lyrics").notNull(),
  sungLyrics: text("sung_lyrics").notNull(),
  verifierReport: jsonb("verifier_report").$type<Record<string, unknown> | null>(),
  source: text("source").$type<"generated" | "regenerated" | "edited" | "mock">().notNull(),
  approved: boolean("approved").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => songRequests.id, { onDelete: "cascade" }),
  lyricDraftId: uuid("lyric_draft_id").notNull().references(() => lyricDrafts.id),
  provider: text("provider").default("kie-suno").notNull(),
  providerTaskId: text("provider_task_id"),
  registryVersion: text("registry_version").notNull(),
  requestPayload: jsonb("request_payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"submitted" | "complete" | "failed">().default("submitted").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
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

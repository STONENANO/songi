/**
 * Step 3 of songcraft: assemble the exact Kie.ai / Suno request.
 *
 * - Model capabilities are explicit; unsupported fields are omitted.
 * - Lyrics and style are validated against the model's limits and rejected,
 *   never truncated.
 * - The request is checked against a runtime schema before it leaves the app.
 *
 * `buildKieInput` stays the public entry point. Without an archetype it builds
 * the signature version, so older call sites keep working.
 */
import { z } from "zod/v4";
import { getGenre, REGISTRY_VERSION, PRESET_VERSION, type Archetype } from "./registry";
import { stripArtistReferences, fitTitle } from "./sanitize";
import { buildMusicDirection, renderStyle, estimateDuration, StyleTooLongError, type MusicDirection } from "./direction";
import { getArrangement } from "./lyrics";

export type ModelCaps = { duration: boolean; durationRange: [number, number]; styleLimit: number; lyricsLimit: number; titleLimit: number };

/** From docs.kie.ai/suno-api/generate-music. Only allowed models (KIE_ALLOWED_MODELS) are ever used. */
export const MODEL_CAPS: Record<string, ModelCaps> = {
  V6: { duration: true, durationRange: [10, 360], styleLimit: 1000, lyricsLimit: 5000, titleLimit: 80 },
  V6_MINI: { duration: true, durationRange: [10, 360], styleLimit: 1000, lyricsLimit: 5000, titleLimit: 80 },
  V6_WILD: { duration: true, durationRange: [10, 360], styleLimit: 1000, lyricsLimit: 5000, titleLimit: 80 },
  V5: { duration: false, durationRange: [0, 0], styleLimit: 1000, lyricsLimit: 5000, titleLimit: 80 },
  V4_5PLUS: { duration: false, durationRange: [0, 0], styleLimit: 1000, lyricsLimit: 5000, titleLimit: 80 },
  V4_5: { duration: false, durationRange: [0, 0], styleLimit: 1000, lyricsLimit: 5000, titleLimit: 80 },
  V4: { duration: false, durationRange: [0, 0], styleLimit: 200, lyricsLimit: 3000, titleLimit: 80 },
};

export class GenerationInputError extends Error {
  constructor(public code: "model_not_allowed" | "lyrics_empty" | "lyrics_over_limit" | "style_over_limit" | "invalid_request" | "vocal_mismatch", message: string) {
    super(message);
    this.name = "GenerationInputError";
  }
}

export const KieMusicInputSchema = z
  .object({
    custom_mode: z.literal(true),
    instrumental: z.literal(false),
    model: z.string().min(1),
    title: z.string().min(1).max(80),
    lyrics: z.string().min(1),
    style: z.string().min(1),
    negative_tags: z.string(),
    vocal_gender: z.enum(["m", "f"]).optional(),
    style_weight: z.number().min(0).max(1),
    weirdness_constraint: z.number().min(0).max(1),
    variety: z.number().int().min(0).max(4),
    duration: z.number().int().min(10).max(360).optional(),
  })
  .strict();
export type KieMusicInput = z.infer<typeof KieMusicInputSchema>;

export type BuildOptions = {
  genreKey: string;
  vocalGender: "m" | "f" | "any";
  mood: string | null;
  customStyle: string | null;
  title: string;
  sungLyrics: string;
  kieModel: string;
  allowedModels?: string[];
  arrangementId?: string | null;
  archetype?: Archetype;
  relationship?: string;
  occasion?: string;
  variantIndex?: number;
  /** Experiments: "legacy" reproduces the v1 style string; "director" (default) uses MusicDirection. */
  directionMode?: "director" | "legacy";
  vocalMode?: "specific" | "generic";
};

export type BuildResult = {
  input: KieMusicInput;
  registryVersion: string;
  presetVersion: string;
  direction: MusicDirection | null;
  styleReport: { dropped: string[]; titleShortened: boolean };
  sanitized: string[];
};

export function modelCaps(model: string, allowed: string[]): ModelCaps {
  const caps = MODEL_CAPS[model];
  if (!caps || !allowed.includes(model)) throw new GenerationInputError("model_not_allowed", `Model "${model}" is not in the allowed list (${allowed.join(", ")}).`);
  return caps;
}

export function buildKieInput(opts: BuildOptions): BuildResult {
  const allowed = opts.allowedModels ?? ["V6", "V6_MINI", "V6_WILD"];
  const caps = modelCaps(opts.kieModel, allowed);
  const genre = getGenre(opts.genreKey);

  const lyrics = opts.sungLyrics.trim();
  if (!lyrics) throw new GenerationInputError("lyrics_empty", "No lyrics to sing.");
  if (lyrics.length > caps.lyricsLimit) {
    throw new GenerationInputError("lyrics_over_limit", `Lyrics are ${lyrics.length} characters; ${opts.kieModel} allows ${caps.lyricsLimit}. They must be shortened by the writer, not cut.`);
  }
  const t = fitTitle(opts.title, caps.titleLimit);

  let style: string;
  let negative: string;
  let params: { styleWeight: number; weirdness: number; variety: 0 | 1 | 2 | 3 | 4 };
  let vocalGender: "m" | "f" | undefined;
  let direction: MusicDirection | null = null;
  let dropped: string[] = [];
  let sanitized: string[] = [];
  const arrangement = getArrangement(opts.arrangementId ?? null, genre);

  if (opts.directionMode === "legacy") {
    // v1 behaviour (minus truncation), for A/B comparison only.
    const vocal = genre.vocal[opts.vocalGender] || genre.vocal.any;
    style = genre.style.replace("{vocal}", vocal).replace(/\s{2,}/g, " ").replace(/\s,/g, ",");
    if (opts.mood) style += `, ${opts.mood} mood`;
    if (opts.customStyle?.trim()) {
      const c = stripArtistReferences(opts.customStyle.trim());
      sanitized = c.removed;
      if (c.text) style += `, ${c.text}`;
    }
    if (style.length > caps.styleLimit) throw new GenerationInputError("style_over_limit", `Style is ${style.length} characters; limit ${caps.styleLimit}.`);
    negative = genre.negativeTags;
    params = genre.params;
    vocalGender = opts.vocalGender === "any" ? undefined : opts.vocalGender;
  } else {
    direction = buildMusicDirection({
      genreKey: genre.key,
      arrangementId: arrangement.id,
      archetype: opts.archetype ?? "signature",
      mood: opts.mood,
      relationship: opts.relationship ?? "",
      occasion: opts.occasion ?? "",
      vocalGender: opts.vocalGender,
      customStyle: opts.customStyle,
      variantIndex: opts.variantIndex,
      vocalMode: opts.vocalMode,
    });
    try {
      ({ style, dropped } = renderStyle(direction, caps.styleLimit));
    } catch (e) {
      if (e instanceof StyleTooLongError) throw new GenerationInputError("style_over_limit", e.message);
      throw e;
    }
    negative = direction.negativeTags.join(", ");
    params = direction.params;
    sanitized = direction.removedArtistRefs;
    vocalGender = direction.vocal.gender === "any" ? undefined : direction.vocal.gender;
    // The customer's explicit voice choice must survive the pipeline unchanged.
    if (opts.vocalGender !== "any" && vocalGender !== opts.vocalGender) {
      throw new GenerationInputError("vocal_mismatch", `Requested ${opts.vocalGender} voice but direction produced ${vocalGender}.`);
    }
  }

  const input: KieMusicInput = {
    custom_mode: true,
    instrumental: false,
    model: opts.kieModel,
    title: t.title,
    lyrics,
    style,
    negative_tags: negative,
    style_weight: params.styleWeight,
    weirdness_constraint: params.weirdness,
    variety: params.variety,
  };
  if (vocalGender) input.vocal_gender = vocalGender;
  if (caps.duration) {
    const energy = direction?.energy ?? "medium";
    input.duration = opts.directionMode === "legacy" ? genre.blueprint.targetDuration : estimateDuration(lyrics, arrangement, energy, caps.durationRange);
  }

  const parsed = KieMusicInputSchema.safeParse(input);
  if (!parsed.success) throw new GenerationInputError("invalid_request", `Request failed validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);

  return {
    input: parsed.data,
    registryVersion: REGISTRY_VERSION,
    presetVersion: PRESET_VERSION,
    direction,
    styleReport: { dropped, titleShortened: t.changed },
    sanitized,
  };
}

/**
 * Step 3 of songcraft: assemble the exact Kie.ai / Suno request from the
 * registry. Free text from the customer is sanitized before it gets anywhere
 * near the style field.
 */
import { getGenre, REGISTRY_VERSION } from "./registry";
import { stripArtistReferences, clamp, LIMITS } from "./sanitize";

export type KieMusicInput = {
  custom_mode: true;
  instrumental: false;
  model: string;
  title: string;
  lyrics: string;
  style: string;
  negative_tags: string;
  vocal_gender?: "m" | "f";
  style_weight: number;
  weirdness_constraint: number;
  variety: 0 | 1 | 2 | 3 | 4;
  duration: number;
};

export function buildKieInput(opts: {
  genreKey: string;
  vocalGender: "m" | "f" | "any";
  mood: string | null;
  customStyle: string | null;
  title: string;
  sungLyrics: string;
  kieModel: string;
}): { input: KieMusicInput; registryVersion: string; sanitized: string[] } {
  const genre = getGenre(opts.genreKey);
  const vocal = genre.vocal[opts.vocalGender] || genre.vocal.any;
  let style = genre.style.replace("{vocal}", vocal).replace(/\s{2,}/g, " ").replace(/\s,/g, ",");
  if (opts.mood) style += `, ${opts.mood} mood`;

  const sanitized: string[] = [];
  if (opts.customStyle?.trim()) {
    const cleaned = stripArtistReferences(opts.customStyle.trim());
    sanitized.push(...cleaned.removed);
    if (cleaned.text) style += `, ${cleaned.text}`;
  }

  const input: KieMusicInput = {
    custom_mode: true,
    instrumental: false,
    model: opts.kieModel,
    title: clamp(opts.title, LIMITS.title),
    lyrics: clamp(opts.sungLyrics, LIMITS.lyrics),
    style: clamp(style, LIMITS.style),
    negative_tags: genre.negativeTags,
    style_weight: genre.params.styleWeight,
    weirdness_constraint: genre.params.weirdness,
    variety: genre.params.variety,
    duration: genre.blueprint.targetDuration,
  };
  if (opts.vocalGender !== "any") input.vocal_gender = opts.vocalGender;
  return { input, registryVersion: REGISTRY_VERSION, sanitized };
}

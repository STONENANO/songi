/**
 * Music direction: a typed, rule-built description of how a version should
 * sound, rendered into one compact Suno style prompt.
 *
 * Built from presets and rules, not an LLM call. Customer sound notes are
 * honoured as constraints; conflicts are resolved explicitly and recorded.
 * Nothing is truncated: optional segments are dropped whole, and if the
 * required content still does not fit, an error is raised.
 */
import {
  getGenre,
  DEFAULT_MOOD_INTENTS,
  MOOD_ENERGY_SHIFT,
  PRESET_VERSION,
  REGISTRY_VERSION,
  VOCAL_PRESETS,
  isRomanticRelationship,
  type Archetype,
  type ArchetypeSpec,
  type Energy,
  type Genre,
  type VocalPresetId,
} from "./registry";
import { ARRANGEMENTS, type Arrangement, type ArrangementId } from "./arrangements";
import { stripArtistReferences } from "./sanitize";

export type MusicDirection = {
  genreKey: string;
  arrangementId: string;
  archetype: Archetype;
  variantLabel: string;
  variantDescription: string;
  emotionalIntent: string;
  energy: Energy;
  vocal: { gender: "m" | "f" | "any"; presetId: string | null; texture: string; delivery: string };
  core: string;
  instrumentation: string[];
  production: string[];
  dynamics: string[];
  negativeTags: string[];
  /** The customer's own sound notes after artist removal and minus fragments applied structurally. */
  customerNotes: string;
  /** Requests recognised and applied, e.g. "no drums". */
  customerConstraints: string[];
  /** Explicit conflict resolutions, shown in logs and available for review. */
  conflicts: string[];
  removedArtistRefs: string[];
  params: { styleWeight: number; weirdness: number; variety: 0 | 1 | 2 | 3 | 4 };
  presetVersion: string;
  registryVersion: string;
};

export class StyleTooLongError extends Error {
  constructor(public length: number, public limit: number) {
    super(`Required style content is ${length} characters; the model allows ${limit}. Shorten the customer's sound notes.`);
    this.name = "StyleTooLongError";
  }
}

const ENERGY_ORDER: Energy[] = ["low", "medium", "high"];
const ENERGY_PHRASE: Record<Energy, string> = { low: "slow tempo, gentle energy", medium: "mid-tempo", high: "upbeat, high energy" };
const ARRANGEMENT_DYNAMICS: Partial<Record<string, string>> = {
  storytelling: "storytelling verses",
  emotional_ballad: "slow-building ballad structure",
  celebration: "singalong chorus",
  hook_first_pop: "opens on the hook",
  rhythmic_rap: "rap verses with a sung hook",
};

function shiftEnergy(e: Energy, by: number): Energy {
  const i = Math.max(0, Math.min(2, ENERGY_ORDER.indexOf(e) + by));
  return ENERGY_ORDER[i];
}

/** Emotional intent from mood, occasion and relationship. Romance only for partners. */
export function emotionalIntent(mood: string | null, occasion: string, relationship: string, conflicts: string[]): string {
  const romanticOk = isRomanticRelationship(relationship);
  if (mood) {
    if (mood === "romantic" && !romanticOk) {
      conflicts.push(`"Romantic" mood for a ${relationship}: using tender and affectionate instead.`);
      return "tender and affectionate";
    }
    return DEFAULT_MOOD_INTENTS[mood] ?? "warm and heartfelt";
  }
  const o = occasion.toLowerCase();
  if (/anniversary|wedding|valentine/.test(o)) return romanticOk ? "romantic and tender" : "warm and loving";
  if (/birthday/.test(o)) return "joyful and warm";
  if (/baby/.test(o)) return "tender and gentle";
  if (/thank/.test(o)) return "grateful and warm";
  if (/graduation|congrat/.test(o)) return "proud and celebratory";
  return "warm and heartfelt";
}

type Working = {
  energy: Energy;
  instrumentation: string[];
  production: string[];
  dynamics: string[];
  negative: string[];
  delivery: string;
  gender: "m" | "f" | "any";
  constraints: string[];
  conflicts: string[];
};

type Rule = { re: RegExp; label: string; apply: (w: Working, g: Genre, quizGender: "m" | "f" | "any") => void };

const drumRe = /drum|percussion|kick|snare|808|claps|snaps|timbales|congas|beat/i;

function addInstrument(w: Working, item: string) {
  if (!w.instrumentation.some((i) => i.toLowerCase().includes(item.toLowerCase()))) w.instrumentation.push(item);
  const before = w.negative.length;
  w.negative = w.negative.filter((n) => !n.toLowerCase().includes(item.toLowerCase().split(" ")[0]));
  if (w.negative.length !== before) w.conflicts.push(`Customer asked for ${item}; removed it from the excluded sounds.`);
}

/** Recognised sound requests. Order matters: exclusions run before additions. */
const RULES: Rule[] = [
  {
    re: /\b(no|without)\s+(drums?|percussion)\b|\bdrumless\b/i,
    label: "no drums",
    apply: (w, g) => {
      w.instrumentation = w.instrumentation.filter((i) => !drumRe.test(i));
      w.dynamics = w.dynamics.filter((d) => !/drop/i.test(d));
      w.negative.push("drums", "percussion");
      if (["dance_pop", "hiphop"].includes(g.key)) w.conflicts.push(`${g.label} normally relies on drums; kept the customer's request for no drums.`);
    },
  },
  {
    re: /\b(acoustic( guitar)? only|only acoustic|unplugged|all acoustic)\b/i,
    label: "acoustic only",
    apply: (w, g) => {
      w.instrumentation = w.instrumentation.filter((i) => !/electric|synth|808|supersaw|risers|organ|bass drop|sub bass/i.test(i));
      if (!w.instrumentation.some((i) => /acoustic/i.test(i))) w.instrumentation.unshift("acoustic guitar");
      w.negative.push("electric guitar", "synths");
      if (["dance_pop", "hiphop"].includes(g.key)) w.conflicts.push(`${g.label} is normally electronic; kept the customer's request for an acoustic sound.`);
    },
  },
  { re: /\bpiano\b/i, label: "piano", apply: (w) => addInstrument(w, "piano") },
  { re: /\bstrings?\b(?!\s+of)/i, label: "strings", apply: (w) => addInstrument(w, "strings") },
  { re: /\bfiddle\b/i, label: "fiddle", apply: (w) => addInstrument(w, "fiddle") },
  { re: /\bviolin\b/i, label: "violin", apply: (w) => addInstrument(w, "violin") },
  { re: /\bcello\b/i, label: "cello", apply: (w) => addInstrument(w, "cello") },
  { re: /\bharmonica\b/i, label: "harmonica", apply: (w) => addInstrument(w, "harmonica") },
  { re: /\bbanjo\b/i, label: "banjo", apply: (w) => addInstrument(w, "banjo") },
  { re: /\bukulele\b/i, label: "ukulele", apply: (w) => addInstrument(w, "ukulele") },
  { re: /\bsax(ophone)?\b/i, label: "saxophone", apply: (w) => addInstrument(w, "saxophone") },
  { re: /\b(horns?|brass|trumpets?)\b/i, label: "horns", apply: (w) => addInstrument(w, "horns") },
  { re: /\bwhistl(e|ing)\b/i, label: "whistling", apply: (w) => addInstrument(w, "whistling") },
  { re: /\bguitar solo\b/i, label: "guitar solo", apply: (w) => addInstrument(w, "guitar solo") },
  { re: /\b(gospel )?choir\b/i, label: "choir", apply: (w) => w.production.push("choir backing vocals") },
  { re: /\blive[- ]band\b/i, label: "live band", apply: (w) => w.production.push("live band feel") },
  { re: /\bno auto-?tune\b/i, label: "no autotune", apply: (w) => w.negative.push("autotune") },
  {
    re: /\b(slow|slower|slowed|gentle tempo|ballad)\b/i,
    label: "slow",
    apply: (w) => {
      if (w.energy !== "low") w.conflicts.push(`Customer asked for a slow feel; energy lowered from ${w.energy}.`);
      w.energy = "low";
      w.dynamics = w.dynamics.filter((d) => !/drop|explosive|massive build/i.test(d));
    },
  },
  {
    re: /\b(upbeat|energetic|fast|faster|danceable|high energy)\b/i,
    label: "upbeat",
    apply: (w, g) => {
      if (g.key === "lullaby") {
        w.conflicts.push("Customer asked for an upbeat feel, but a lullaby must stay gentle; kept a soft tempo.");
        return;
      }
      w.energy = "high";
    },
  },
  {
    re: /\b(female|woman|woman's|feminine|girl)\s+(vocals?|voice|singer)\b/i,
    label: "female vocal",
    apply: (w, _g, quiz) => {
      if (quiz === "m") w.conflicts.push("Sound notes ask for a female voice but the quiz chose male; kept the quiz choice.");
      else w.gender = "f";
    },
  },
  {
    re: /\b(male|man|man's|masculine|guy)\s+(vocals?|voice|singer)\b/i,
    label: "male vocal",
    apply: (w, _g, quiz) => {
      if (quiz === "f") w.conflicts.push("Sound notes ask for a male voice but the quiz chose female; kept the quiz choice.");
      else w.gender = "m";
    },
  },
  { re: /\b(soft|gentle|whisper(y|ed)?|breathy)\s+(vocals?|voice|singing)\b/i, label: "soft vocal", apply: (w) => (w.delivery = `soft, ${w.delivery}`) },
];

/** Parse customer sound notes into structural changes; return the unmatched remainder as verbatim notes. */
export function applyCustomerStyle(text: string, w: Working, genre: Genre, quizGender: "m" | "f" | "any"): { notes: string; removed: string[] } {
  const { text: clean, removed } = stripArtistReferences(text);
  if (removed.length) w.conflicts.push(`Removed artist references from the sound notes: ${removed.join(", ")}.`);
  let rest = clean;
  for (const r of RULES) {
    const m = rest.match(r.re);
    if (!m) continue;
    r.apply(w, genre, quizGender);
    w.constraints.push(r.label);
    rest = rest.replace(new RegExp(r.re.source, r.re.flags.includes("g") ? r.re.flags : r.re.flags + "g"), " ");
  }
  rest = rest
    .replace(/\b(and|with|a|an|the|please|but|plus|some)\b(?=\s*[,.;]|\s*$)/gi, "")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;-]+|[\s,.;-]+$/g, "")
    .trim();
  return { notes: /[a-z]{3,}/i.test(rest) ? rest : "", removed };
}

export type DirectionInput = {
  genreKey: string;
  arrangementId: string;
  archetype: Archetype;
  mood: string | null;
  relationship: string;
  occasion: string;
  vocalGender: "m" | "f" | "any";
  customStyle: string | null;
  /** For "any" voice: alternates the voice across versions for a meaningful choice. */
  variantIndex?: number;
  /** Experiment: "generic" uses the v1 vocal words instead of specific presets. */
  vocalMode?: "specific" | "generic";
};

export function buildMusicDirection(input: DirectionInput): MusicDirection {
  const genre = getGenre(input.genreKey);
  const spec: ArchetypeSpec | undefined = genre.archetypes[input.archetype] ?? genre.archetypes.signature;
  if (!spec) throw new Error(`Genre ${genre.key} has no "${input.archetype}" or signature archetype.`);
  const archetype = genre.archetypes[input.archetype] ? input.archetype : "signature";
  const moodOv = input.mood ? genre.moods[input.mood] : undefined;
  const conflicts: string[] = [];
  const intent = emotionalIntent(input.mood, input.occasion, input.relationship, conflicts);

  const romanticOk = isRomanticRelationship(input.relationship);
  const useMoodOverride = moodOv && !(input.mood === "romantic" && !romanticOk);
  let energy: Energy = (useMoodOverride && moodOv?.energy?.[archetype]) || spec.energy;
  if (!(useMoodOverride && moodOv?.energy?.[archetype]) && input.mood) energy = shiftEnergy(energy, MOOD_ENERGY_SHIFT[input.mood] ?? 0);

  const w: Working = {
    energy,
    instrumentation: [...((useMoodOverride && moodOv?.instrumentation?.[archetype]) || spec.instrumentation)],
    production: [...((useMoodOverride && moodOv?.production?.[archetype]) || spec.production)],
    dynamics: [...((useMoodOverride && moodOv?.dynamics?.[archetype]) || spec.dynamics)],
    negative: [...genre.excluded],
    delivery: (useMoodOverride && moodOv?.delivery) || spec.delivery,
    gender: input.vocalGender,
    constraints: [],
    conflicts,
  };
  const core = (useMoodOverride && moodOv?.core?.[archetype]) || spec.core;

  let notes = "";
  let removed: string[] = [];
  if (input.customStyle?.trim()) ({ notes, removed } = applyCustomerStyle(input.customStyle.trim(), w, genre, input.vocalGender));

  // "Any" voice: alternate across versions so the customer hears a real choice.
  if (w.gender === "any") w.gender = (input.variantIndex ?? 0) % 2 === 0 ? "f" : "m";
  const presetId: VocalPresetId = spec.vocal[w.gender];
  const preset = VOCAL_PRESETS[presetId];
  const texture = input.vocalMode === "generic" ? `${genre.vocal[w.gender]} vocal` : preset.text;

  const arrDyn = ARRANGEMENT_DYNAMICS[input.arrangementId];
  if (arrDyn && !w.dynamics.some((d) => d.toLowerCase() === arrDyn)) w.dynamics.unshift(arrDyn);

  // Never exclude something the direction itself asks for.
  const positive = [...w.instrumentation, ...w.production].join(" ").toLowerCase();
  const negativeTags = [...new Set(w.negative)].filter((n) => !positive.includes(n.toLowerCase()));

  return {
    genreKey: genre.key,
    arrangementId: input.arrangementId,
    archetype,
    variantLabel: spec.label,
    variantDescription: spec.description,
    emotionalIntent: intent,
    energy: w.energy,
    vocal: { gender: w.gender, presetId: input.vocalMode === "generic" ? null : presetId, texture, delivery: w.delivery },
    core,
    instrumentation: w.instrumentation,
    production: w.production,
    dynamics: w.dynamics,
    negativeTags,
    customerNotes: notes,
    customerConstraints: w.constraints,
    conflicts: w.conflicts,
    removedArtistRefs: removed,
    params: spec.params,
    presetVersion: PRESET_VERSION,
    registryVersion: REGISTRY_VERSION,
  };
}

type Segment = { text: string; required: boolean; dropPriority: number };

/** Always in the style prompt: testers heard the beat drowning out the singer. */
export const VOCAL_FORWARD = "vocal-forward mix, clear upfront lead vocal";

/**
 * Render the style prompt in a fixed order: genre and arrangement, energy and
 * intent, vocal, instrumentation, production, dynamics, customer notes.
 * Optional segments are dropped whole (lowest priority first) to fit `limit`.
 */
export function renderStyle(d: MusicDirection, limit: number): { style: string; dropped: string[] } {
  const vocalText = /vocal|voice|delivery|flow|lead|crooner/i.test(d.vocal.texture) ? d.vocal.texture : `${d.vocal.texture} vocal`;
  // Drop delivery words the vocal preset already says ("clear expressive alto" + "warm and expressive" -> "warm").
  const said = new Set(vocalText.toLowerCase().match(/[a-z-]+/g) ?? []);
  const delivery = d.vocal.delivery
    .split(/,\s*|\s+and\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !w.split(/\s+/).every((t) => said.has(t.toLowerCase())))
    .join(" and ");
  const segs: Segment[] = [
    { text: d.core, required: true, dropPriority: 0 },
    { text: `${ENERGY_PHRASE[d.energy]}, ${d.emotionalIntent}`, required: true, dropPriority: 0 },
    { text: delivery ? `${vocalText}, ${delivery}` : vocalText, required: true, dropPriority: 0 },
    // Suno tends to bury the voice under dense production; ask for a vocal-led mix early in the prompt.
    { text: VOCAL_FORWARD, required: true, dropPriority: 0 },
    ...d.instrumentation.map((t, i) => ({ text: t, required: i < 2, dropPriority: 3 + i })),
    ...d.production.map((t, i) => ({ text: t, required: false, dropPriority: 6 + i })),
    ...d.dynamics.map((t, i) => ({ text: t, required: false, dropPriority: 10 + i })),
    ...(d.customerNotes ? [{ text: d.customerNotes, required: true, dropPriority: 0 }] : []),
  ];
  // De-duplicate repeated phrases across segments.
  const seen = new Set<string>();
  let kept = segs.filter((s) => {
    const k = s.text.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const dropped: string[] = [];
  const join = (xs: Segment[]) => xs.map((s) => s.text.trim()).join(", ");
  while (join(kept).length > limit) {
    const optional = kept.filter((s) => !s.required).sort((a, b) => b.dropPriority - a.dropPriority);
    if (!optional.length) throw new StyleTooLongError(join(kept).length, limit);
    dropped.push(optional[0].text);
    kept = kept.filter((s) => s !== optional[0]);
  }
  return { style: join(kept), dropped };
}

/** One-line, customer-safe description of a version. */
export function styleSummary(d: MusicDirection): string {
  const voice = d.vocal.gender === "f" ? "female voice" : d.vocal.gender === "m" ? "male voice" : "lead voice";
  return `${d.variantDescription}. ${voice.charAt(0).toUpperCase()}${voice.slice(1)}.`;
}

/**
 * Estimate song length from the lyrics actually being sung, the arrangement's
 * vocal density and its usual instrumental space. Only the number is clamped.
 */
export function estimateDuration(sungLyrics: string, arrangement: Arrangement, energy: Energy, providerRange: [number, number] = [10, 360]): number {
  const words = sungLyrics.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
  const density = arrangement.vocalDensity * (energy === "low" ? 0.9 : energy === "high" ? 1.1 : 1);
  const raw = words / density + arrangement.instrumentalSeconds;
  const [lo, hi] = arrangement.duration;
  const clampedToArrangement = Math.min(hi, Math.max(lo, raw));
  return Math.round(Math.min(providerRange[1], Math.max(providerRange[0], clampedToArrangement)));
}

export function arrangementFor(id: string): Arrangement | null {
  return (ARRANGEMENTS as Record<string, Arrangement>)[id as ArrangementId] ?? null;
}

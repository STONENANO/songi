/**
 * The genre registry. Every Suno style prompt is assembled from here, never
 * from free text, so output is consistent and no artist names reach Suno.
 *
 * Versioning: REGISTRY_VERSION covers lyric blueprints and genre notes;
 * PRESET_VERSION covers musical presets (archetypes, vocals, parameters).
 * Both are stored on every generation so results can be compared over time.
 *
 * Vocal presets and archetype parameters are EXPERIMENTAL until validated by
 * listening tests. They are starting points, not proven settings.
 */
import type { ArrangementId } from "./arrangements";

export const REGISTRY_VERSION = "2026-11-10.2";
export const PRESET_VERSION = "presets-2026-11-10.1";

/* -------------------------------------------------------------------------- */
/* Legacy blueprint (v1) – kept for backward compatibility and A/B tests       */
/* -------------------------------------------------------------------------- */

export type Blueprint = {
  sections: { tag: string; lines: number; note?: string }[];
  syllables: [number, number];
  rhyme: string;
  targetDuration: number;
};

const standardBlueprint: Blueprint = {
  sections: [
    { tag: "Verse 1", lines: 4, note: "Set the scene with the most vivid fact." },
    { tag: "Chorus", lines: 4, note: "Name in the first or second line. The emotional core. Repeated verbatim later." },
    { tag: "Verse 2", lines: 4, note: "Second and third facts." },
    { tag: "Chorus", lines: 4, note: "Identical to the first chorus." },
    { tag: "Bridge", lines: 2, note: "A turn: gratitude, a wish, or the inside joke." },
    { tag: "Chorus", lines: 4, note: "Identical to the first chorus." },
    { tag: "Outro", lines: 2, note: "Short, lands on the name." },
  ],
  syllables: [6, 10],
  rhyme: "AABB or ABAB within each section",
  targetDuration: 165,
};
const rapBlueprint: Blueprint = {
  sections: [
    { tag: "Intro", lines: 2, note: "Spoken-feel shoutout to the recipient." },
    { tag: "Verse 1", lines: 8, note: "Dense with facts, internal rhyme." },
    { tag: "Chorus", lines: 4, note: "Chanted hook with the name." },
    { tag: "Verse 2", lines: 8, note: "More facts, the inside joke." },
    { tag: "Chorus", lines: 4, note: "Identical to the first chorus." },
    { tag: "Outro", lines: 2, note: "Lands on the name." },
  ],
  syllables: [9, 14],
  rhyme: "couplets with internal rhyme",
  targetDuration: 160,
};
const lullabyBlueprint: Blueprint = {
  sections: [
    { tag: "Verse 1", lines: 4, note: "Soft, concrete, present tense." },
    { tag: "Chorus", lines: 4, note: "Gentle refrain with the name, like a promise." },
    { tag: "Verse 2", lines: 4 },
    { tag: "Chorus", lines: 4, note: "Identical to the first chorus." },
    { tag: "Outro", lines: 2, note: "Trails off, lands on the name." },
  ],
  syllables: [5, 8],
  rhyme: "ABCB",
  targetDuration: 140,
};

/* -------------------------------------------------------------------------- */
/* Vocal presets                                                               */
/* -------------------------------------------------------------------------- */

export type VocalPreset = { gender: "m" | "f"; text: string; genres: string[] };

export const VOCAL_PRESETS = {
  warm_gravelly_baritone: { gender: "m", text: "warm gravelly baritone", genres: ["country", "rock", "acoustic", "soul_gospel"] },
  intimate_breathy_tenor: { gender: "m", text: "intimate breathy tenor", genres: ["pop", "acoustic", "indie_pop", "rnb", "lullaby", "dance_pop", "latin_pop"] },
  soulful_velvet_baritone: { gender: "m", text: "soulful velvet baritone", genres: ["rnb", "soul_gospel", "jazz", "latin_pop"] },
  bright_melodic_tenor: { gender: "m", text: "bright melodic tenor", genres: ["pop", "dance_pop", "country", "latin_pop", "indie_pop", "rock"] },
  clear_expressive_alto: { gender: "f", text: "clear expressive alto", genres: ["pop", "country", "acoustic", "indie_pop", "rock", "latin_pop", "dance_pop"] },
  warm_smoky_contralto: { gender: "f", text: "warm smoky contralto", genres: ["jazz", "rnb", "soul_gospel", "acoustic"] },
  powerful_soulful_mezzo: { gender: "f", text: "powerful soulful mezzo-soprano", genres: ["pop", "rnb", "soul_gospel", "rock", "dance_pop", "latin_pop", "country", "jazz"] },
  soft_intimate_soprano: { gender: "f", text: "soft intimate soprano", genres: ["pop", "acoustic", "indie_pop", "lullaby"] },
  country_twang_f: { gender: "f", text: "bright female country vocal with a light twang", genres: ["country"] },
  country_warm_m: { gender: "m", text: "warm male country vocal with a light drawl", genres: ["country"] },
  gospel_lead_f: { gender: "f", text: "expressive female gospel lead", genres: ["soul_gospel"] },
  gospel_lead_m: { gender: "m", text: "expressive male gospel lead", genres: ["soul_gospel"] },
  rap_rhythmic_f: { gender: "f", text: "confident rhythmic female rap delivery", genres: ["hiphop"] },
  rap_rhythmic_m: { gender: "m", text: "confident rhythmic male rap delivery", genres: ["hiphop"] },
  rap_laidback_f: { gender: "f", text: "laid-back conversational female rap flow", genres: ["hiphop"] },
  rap_laidback_m: { gender: "m", text: "laid-back conversational male rap flow", genres: ["hiphop"] },
  jazz_crooner_m: { gender: "m", text: "smooth baritone crooner", genres: ["jazz"] },
  lullaby_hush_f: { gender: "f", text: "soft hushed female voice", genres: ["lullaby"] },
  lullaby_hush_m: { gender: "m", text: "soft hushed male voice", genres: ["lullaby"] },
  rock_gritty_m: { gender: "m", text: "powerful gritty male rock vocal", genres: ["rock"] },
  rock_grit_f: { gender: "f", text: "powerful female rock vocal with grit", genres: ["rock"] },
} as const satisfies Record<string, VocalPreset>;
export type VocalPresetId = keyof typeof VOCAL_PRESETS;

/* -------------------------------------------------------------------------- */
/* Genres                                                                      */
/* -------------------------------------------------------------------------- */

export type Archetype = "intimate" | "signature" | "expressive";
export const ARCHETYPE_ORDER: Archetype[] = ["signature", "intimate", "expressive"];
export type Energy = "low" | "medium" | "high";

export type ArchetypeSpec = {
  /** Customer-facing name. Must describe what the version actually sounds like. */
  label: string;
  /** Customer-facing one-line description. */
  description: string;
  core: string;
  energy: Energy;
  instrumentation: string[];
  production: string[];
  dynamics: string[];
  vocal: { m: VocalPresetId; f: VocalPresetId };
  delivery: string;
  params: { styleWeight: number; weirdness: number; variety: 0 | 1 | 2 | 3 | 4 };
};

/** Genre-specific adjustments for a mood. Unlisted moods use DEFAULT_MOOD_INTENTS only. */
export type MoodOverride = {
  core?: Partial<Record<Archetype, string>>;
  instrumentation?: Partial<Record<Archetype, string[]>>;
  production?: Partial<Record<Archetype, string[]>>;
  dynamics?: Partial<Record<Archetype, string[]>>;
  delivery?: string;
  energy?: Partial<Record<Archetype, Energy>>;
};

export type Genre = {
  key: string;
  label: string;
  tagline: string;
  identity: string;
  arrangements: ArrangementId[];
  excluded: string[];
  archetypes: Partial<Record<Archetype, ArchetypeSpec>>;
  moods: Partial<Record<string, MoodOverride>>;
  /** Writing guidance for the lyricist. Musical only: never suggests scenes, objects or places. */
  lyricNotes: string;
  // ---- v1 fields, kept for legacy drafts and A/B comparison ----
  style: string;
  negativeTags: string;
  vocal: { m: string; f: string; any: string };
  params: { styleWeight: number; weirdness: number; variety: 0 | 1 | 2 | 3 | 4 };
  blueprint: Blueprint;
};

export const DEFAULT_MOOD_INTENTS: Record<string, string> = {
  heartfelt: "heartfelt and grateful",
  romantic: "romantic and tender",
  celebratory: "joyful and celebratory",
  funny: "playful and cheeky",
  nostalgic: "warm and nostalgic",
  uplifting: "uplifting and hopeful",
  calm: "calm and gentle",
};
export const MOOD_ENERGY_SHIFT: Record<string, -1 | 0 | 1> = { celebratory: 1, funny: 1, calm: -1, heartfelt: 0, nostalgic: 0, romantic: 0, uplifting: 0 };

export const GENRES: Record<string, Genre> = {
  pop: {
    key: "pop",
    label: "Pop",
    tagline: "Big, bright, made to sing along",
    identity: "modern pop",
    arrangements: ["hook_first_pop", "celebration", "emotional_ballad"],
    excluded: ["heavy metal", "screaming", "distorted guitars", "lo-fi noise"],
    archetypes: {
      intimate: { label: "Stripped-Back Pop", description: "Piano-led and close, the words up front", core: "stripped-back pop ballad", energy: "low", instrumentation: ["felt piano", "soft pads", "light finger snaps"], production: ["clean intimate mix", "close-mic vocal"], dynamics: ["gentle build into the last chorus"], vocal: { m: "intimate_breathy_tenor", f: "soft_intimate_soprano" }, delivery: "tender and sincere", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Radio Pop", description: "Bright, polished and made to sing along", core: "modern radio pop", energy: "medium", instrumentation: ["punchy drums", "bright synths", "clean electric guitar"], production: ["polished radio production", "wide chorus"], dynamics: ["catchy anthemic chorus", "lift into the final chorus"], vocal: { m: "bright_melodic_tenor", f: "clear_expressive_alto" }, delivery: "warm and confident", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      expressive: { label: "Big Pop Anthem", description: "Soaring and cinematic", core: "anthemic pop", energy: "high", instrumentation: ["driving drums", "layered synths", "strings"], production: ["big cinematic mix", "stacked harmonies"], dynamics: ["soaring final chorus"], vocal: { m: "bright_melodic_tenor", f: "powerful_soulful_mezzo" }, delivery: "powerful and emotional", params: { styleWeight: 0.65, weirdness: 0.3, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Simple words, big feelings, a chorus people can sing back after one listen.",
    style: "upbeat modern pop, bright synths, punchy drums, catchy anthemic chorus, polished radio production, {vocal} lead vocal, warm and heartfelt",
    negativeTags: "heavy metal, screaming, distorted guitars, lo-fi noise",
    vocal: { m: "confident male", f: "clear female", any: "clear" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
  },
  acoustic: {
    key: "acoustic",
    label: "Acoustic",
    tagline: "Intimate guitar and piano",
    identity: "acoustic singer-songwriter",
    arrangements: ["emotional_ballad", "storytelling"],
    excluded: ["electronic drums", "synths", "autotune", "heavy bass"],
    archetypes: {
      intimate: { label: "Voice & Guitar", description: "Just a voice and a fingerpicked guitar", core: "solo acoustic ballad", energy: "low", instrumentation: ["fingerpicked acoustic guitar"], production: ["natural room ambience", "close-mic vocal"], dynamics: ["quiet and steady, slight swell in the bridge"], vocal: { m: "intimate_breathy_tenor", f: "soft_intimate_soprano" }, delivery: "tender and conversational", params: { styleWeight: 0.8, weirdness: 0.15, variety: 1 } },
      signature: { label: "Warm Acoustic", description: "Guitar and piano with a warm, gentle band", core: "warm acoustic singer-songwriter", energy: "low", instrumentation: ["acoustic guitar", "soft piano", "light brushed percussion"], production: ["warm natural mix"], dynamics: ["gradual emotional build"], vocal: { m: "warm_gravelly_baritone", f: "clear_expressive_alto" }, delivery: "sincere and warm", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      expressive: { label: "Acoustic with Strings", description: "A fuller arrangement with strings and a big finish", core: "cinematic acoustic ballad", energy: "medium", instrumentation: ["acoustic guitar", "piano", "string section"], production: ["rich warm mix", "soft harmonies"], dynamics: ["builds to an emotional final chorus"], vocal: { m: "warm_gravelly_baritone", f: "warm_smoky_contralto" }, delivery: "emotional and open", params: { styleWeight: 0.7, weirdness: 0.25, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Conversational and specific; small real details carry the emotion. Avoid cliches.",
    style: "intimate acoustic ballad, fingerpicked acoustic guitar, soft piano, light strings, gentle dynamics, {vocal} vocal close to the mic, tender and sincere",
    negativeTags: "electronic drums, synths, autotune, heavy bass",
    vocal: { m: "warm male", f: "soft female", any: "warm" },
    params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
  },
  country: {
    key: "country",
    label: "Country",
    tagline: "Warm storytelling",
    identity: "modern country",
    arrangements: ["storytelling", "emotional_ballad", "celebration"],
    excluded: ["EDM", "trap", "rap", "heavy metal"],
    archetypes: {
      intimate: { label: "Heartfelt Acoustic", description: "Acoustic guitar, gentle pedal steel, close vocal", core: "intimate singer-songwriter country", energy: "low", instrumentation: ["gentle acoustic guitar", "restrained pedal steel"], production: ["natural room ambience", "close warm vocal"], dynamics: ["conversational verses", "gradual emotional build"], vocal: { m: "warm_gravelly_baritone", f: "clear_expressive_alto" }, delivery: "warm and expressive", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Modern Country", description: "Full band with a big singalong chorus", core: "modern country", energy: "medium", instrumentation: ["acoustic and electric guitars", "pedal steel", "live drums"], production: ["polished Nashville production"], dynamics: ["storytelling verses", "big singalong chorus"], vocal: { m: "country_warm_m", f: "country_twang_f" }, delivery: "warm and confident", params: { styleWeight: 0.7, weirdness: 0.2, variety: 1 } },
      expressive: { label: "Big-Stage Country", description: "Arena-sized guitars and a soaring finish", core: "anthemic country rock", energy: "high", instrumentation: ["driving electric guitars", "pedal steel", "big live drums", "fiddle"], production: ["wide arena mix", "stacked harmonies"], dynamics: ["soaring final chorus"], vocal: { m: "warm_gravelly_baritone", f: "powerful_soulful_mezzo" }, delivery: "powerful and heartfelt", params: { styleWeight: 0.65, weirdness: 0.25, variety: 2 } },
    },
    moods: {
      heartfelt: {
        core: { signature: "heartfelt modern country ballad" },
        instrumentation: { signature: ["acoustic guitar", "restrained pedal steel", "soft live drums"] },
        dynamics: { signature: ["conversational verses", "gradual emotional build", "full final chorus"] },
        delivery: "warm and expressive",
        energy: { signature: "low", expressive: "medium" },
      },
      celebratory: {
        core: { signature: "upbeat modern country" },
        instrumentation: { signature: ["bright acoustic and electric guitars", "live drums", "fiddle"] },
        dynamics: { signature: ["memorable singalong chorus", "joyful full-band arrangement"] },
        delivery: "confident and energetic",
        energy: { signature: "high" },
      },
    },
    lyricNotes: "Tell it like a story, using concrete nouns from the customer's own details. Do not add scenery, vehicles or places the customer did not mention.",
    style: "modern country, acoustic and electric guitar, pedal steel, steady drums, storytelling verses, big singalong chorus, {vocal} vocal with a slight twang, warm and nostalgic",
    negativeTags: "EDM, trap, rap, heavy metal",
    vocal: { m: "rich male", f: "bright female", any: "warm" },
    params: { styleWeight: 0.7, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
  },
  rnb: {
    key: "rnb",
    label: "R&B",
    tagline: "Smooth, groovy and soulful",
    identity: "contemporary R&B",
    arrangements: ["emotional_ballad", "hook_first_pop"],
    excluded: ["rock", "country", "metal", "screaming"],
    archetypes: {
      intimate: { label: "Late-Night R&B", description: "Minimal keys and a close, soulful vocal", core: "minimal late-night R&B", energy: "low", instrumentation: ["Rhodes-style electric piano", "soft sub bass"], production: ["intimate warm mix", "close vocal with subtle reverb"], dynamics: ["restrained throughout, opens up in the bridge"], vocal: { m: "intimate_breathy_tenor", f: "warm_smoky_contralto" }, delivery: "intimate and sincere", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Smooth R&B", description: "Laid-back groove, warm keys, lush harmonies", core: "smooth contemporary R&B", energy: "medium", instrumentation: ["warm electric piano", "deep bass groove", "soft snaps"], production: ["lush layered harmonies", "polished warm mix"], dynamics: ["melodic chorus with vocal runs"], vocal: { m: "soulful_velvet_baritone", f: "powerful_soulful_mezzo" }, delivery: "smooth and soulful", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      expressive: { label: "Soulful R&B", description: "Live band, big vocals, gospel-tinged finish", core: "soulful neo-soul R&B", energy: "medium", instrumentation: ["live bass", "electric piano", "organ", "live drums"], production: ["warm analog feel", "backing vocal stacks"], dynamics: ["builds to a powerful final chorus"], vocal: { m: "soulful_velvet_baritone", f: "powerful_soulful_mezzo" }, delivery: "expressive with runs and ad-libs", params: { styleWeight: 0.65, weirdness: 0.3, variety: 2 } },
    },
    moods: {
      heartfelt: {
        core: { signature: "warm contemporary soul R&B", intimate: "warm intimate soul R&B" },
        instrumentation: { signature: ["Rhodes-style electric piano", "gentle bass groove"] },
        production: { signature: ["soft harmonies", "warm mix"] },
        delivery: "grateful and sincere",
      },
      romantic: {
        core: { signature: "smooth contemporary R&B" },
        instrumentation: { signature: ["warm bass", "electric piano", "restrained percussion"] },
        dynamics: { signature: ["emotional melodic chorus"] },
        delivery: "sensual but tasteful",
      },
    },
    lyricNotes: "Smooth phrasing with room for runs. Repetition of a short hook works well.",
    style: "smooth contemporary R&B, laid-back groove, warm electric piano, deep bass, soft snaps, lush harmonies, {vocal} vocal with runs and ad-libs, romantic and soulful",
    negativeTags: "rock, country, metal, screaming",
    vocal: { m: "silky male", f: "sultry female", any: "silky" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
  },
  hiphop: {
    key: "hiphop",
    label: "Hip-Hop",
    tagline: "Boom-bap beats, real rap",
    identity: "hip hop",
    arrangements: ["rhythmic_rap"],
    excluded: ["country", "metal", "acoustic ballad", "slow tempo"],
    archetypes: {
      intimate: { label: "Laid-Back Lo-Fi", description: "Mellow beat, conversational flow", core: "mellow lo-fi hip hop", energy: "low", instrumentation: ["dusty drums", "jazzy piano loop", "warm bass"], production: ["warm vinyl-style mix"], dynamics: ["steady relaxed groove", "sung hook"], vocal: { m: "rap_laidback_m", f: "rap_laidback_f" }, delivery: "relaxed and heartfelt", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      signature: { label: "Boom-Bap", description: "Punchy drums, sampled keys, confident flow", core: "boom bap hip hop", energy: "medium", instrumentation: ["punchy drums", "warm sampled keys", "deep bass"], production: ["crisp head-nodding mix"], dynamics: ["verses ride the beat", "sung melodic hook"], vocal: { m: "rap_rhythmic_m", f: "rap_rhythmic_f" }, delivery: "playful and confident", params: { styleWeight: 0.7, weirdness: 0.3, variety: 1 } },
      expressive: { label: "Anthem Hip-Hop", description: "Big drums and a stadium-sized hook", core: "anthemic hip hop", energy: "high", instrumentation: ["hard-hitting drums", "brass stabs", "big synth bass"], production: ["wide punchy mix", "gang vocal hook"], dynamics: ["explosive chorus"], vocal: { m: "rap_rhythmic_m", f: "rap_rhythmic_f" }, delivery: "energetic and proud", params: { styleWeight: 0.65, weirdness: 0.3, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Rhythmic and witty, dense with the customer's specifics. Clean language. The hook is sung and simple.",
    style: "boom bap hip hop, punchy drums, warm sampled keys, head-nodding groove, {vocal} rapper with clear confident flow, playful and celebratory, sung melodic hook",
    negativeTags: "country, metal, acoustic ballad, slow tempo",
    vocal: { m: "male", f: "female", any: "" },
    params: { styleWeight: 0.7, weirdness: 0.3, variety: 1 },
    blueprint: rapBlueprint,
  },
  rock: {
    key: "rock",
    label: "Rock",
    tagline: "Loud guitars, big choruses",
    identity: "rock",
    arrangements: ["celebration", "storytelling", "emotional_ballad"],
    excluded: ["EDM", "trap", "lo-fi", "whispering"],
    archetypes: {
      intimate: { label: "Acoustic Rock", description: "Strummed guitars and an honest vocal", core: "acoustic rock ballad", energy: "low", instrumentation: ["strummed acoustic guitar", "light electric guitar", "soft drums"], production: ["warm live-room mix"], dynamics: ["builds gently to the last chorus"], vocal: { m: "warm_gravelly_baritone", f: "clear_expressive_alto" }, delivery: "honest and warm", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Anthemic Rock", description: "Driving guitars and a chorus you can shout", core: "anthemic rock", energy: "high", instrumentation: ["driving electric guitars", "big drums", "bass"], production: ["punchy live-band mix"], dynamics: ["soaring chorus", "guitar break before the last chorus"], vocal: { m: "rock_gritty_m", f: "rock_grit_f" }, delivery: "triumphant and heartfelt", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      expressive: { label: "Stadium Rock", description: "Huge and cinematic with a guitar solo", core: "stadium rock power ballad", energy: "high", instrumentation: ["layered electric guitars", "pounding drums", "guitar solo"], production: ["huge arena mix", "stacked harmonies"], dynamics: ["slow build to an explosive final chorus"], vocal: { m: "rock_gritty_m", f: "powerful_soulful_mezzo" }, delivery: "powerful and emotional", params: { styleWeight: 0.65, weirdness: 0.3, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Short punchy lines. A chorus you can shout.",
    style: "anthemic rock, driving electric guitars, big drums, soaring chorus, stadium energy, {vocal} powerful vocal, triumphant and heartfelt",
    negativeTags: "EDM, trap, lo-fi, whispering",
    vocal: { m: "gritty male", f: "powerful female", any: "powerful" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
  },
  soul_gospel: {
    key: "soul_gospel",
    label: "Soul & Gospel",
    tagline: "Warm organ, powerful voices",
    identity: "soul gospel",
    arrangements: ["emotional_ballad", "celebration"],
    excluded: ["EDM", "trap", "metal", "autotune"],
    archetypes: {
      intimate: { label: "Piano & Voice Soul", description: "Gospel piano and a heartfelt lead", core: "intimate gospel soul ballad", energy: "low", instrumentation: ["gospel piano", "soft organ"], production: ["warm church-room ambience"], dynamics: ["quiet start, swells in the bridge"], vocal: { m: "gospel_lead_m", f: "gospel_lead_f" }, delivery: "heartfelt and grateful", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Soul Gospel", description: "Organ, hand claps and a joyful choir", core: "uplifting soul gospel", energy: "medium", instrumentation: ["Hammond organ", "live drums", "hand claps"], production: ["full choir backing vocals", "warm live mix"], dynamics: ["building dynamics", "call and response chorus"], vocal: { m: "gospel_lead_m", f: "gospel_lead_f" }, delivery: "joyful and full of feeling", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      expressive: { label: "Full Choir Gospel", description: "Big choir, key-lifting finale", core: "powerful choir gospel", energy: "high", instrumentation: ["Hammond organ", "piano", "live drums", "bass"], production: ["massive choir", "wide live mix"], dynamics: ["builds to a rousing final chorus"], vocal: { m: "warm_gravelly_baritone", f: "powerful_soulful_mezzo" }, delivery: "powerful and rousing", params: { styleWeight: 0.7, weirdness: 0.25, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Gratitude and uplift. Call and response in the chorus is welcome.",
    style: "uplifting soul gospel, Hammond organ, live drums, hand claps, full choir backing vocals, building dynamics, {vocal} lead vocal full of feeling, grateful and joyful",
    negativeTags: "EDM, trap, metal, autotune",
    vocal: { m: "rich male", f: "powerhouse female", any: "powerful" },
    params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
  },
  indie_pop: {
    key: "indie_pop",
    label: "Indie Pop",
    tagline: "Warm, dreamy, a little retro",
    identity: "indie pop",
    arrangements: ["storytelling", "hook_first_pop", "emotional_ballad"],
    excluded: ["metal", "trap", "EDM drops", "screaming"],
    archetypes: {
      intimate: { label: "Bedroom Indie", description: "Soft guitar and a breathy, close vocal", core: "bedroom indie pop", energy: "low", instrumentation: ["soft clean guitar", "warm analog synth"], production: ["lo-key intimate mix"], dynamics: ["gentle and even"], vocal: { m: "intimate_breathy_tenor", f: "soft_intimate_soprano" }, delivery: "breathy and charming", params: { styleWeight: 0.7, weirdness: 0.3, variety: 1 } },
      signature: { label: "Sunny Indie Pop", description: "Jangly guitars and a sunny chorus", core: "sunny indie pop", energy: "medium", instrumentation: ["jangly guitars", "warm analog synths", "soft drums"], production: ["nostalgic warm mix"], dynamics: ["bright, bouncy chorus"], vocal: { m: "bright_melodic_tenor", f: "clear_expressive_alto" }, delivery: "warm and charming", params: { styleWeight: 0.65, weirdness: 0.3, variety: 1 } },
      expressive: { label: "Dreamy Indie Anthem", description: "Shimmering and swelling", core: "dreamy indie anthem", energy: "medium", instrumentation: ["shimmering guitars", "synth pads", "driving drums"], production: ["lush reverb", "layered vocals"], dynamics: ["swells into a big final chorus"], vocal: { m: "intimate_breathy_tenor", f: "clear_expressive_alto" }, delivery: "dreamy and heartfelt", params: { styleWeight: 0.6, weirdness: 0.35, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Quirky real details welcome. Understated emotion.",
    style: "dreamy indie pop, jangly guitars, warm analog synths, soft drums, nostalgic and sunny, {vocal} breathy vocal, intimate and charming",
    negativeTags: "metal, trap, EDM drops, screaming",
    vocal: { m: "soft male", f: "airy female", any: "soft" },
    params: { styleWeight: 0.65, weirdness: 0.3, variety: 1 },
    blueprint: standardBlueprint,
  },
  dance_pop: {
    key: "dance_pop",
    label: "Dance Pop",
    tagline: "Feel-good dance-floor beats",
    identity: "dance pop",
    arrangements: ["celebration", "hook_first_pop"],
    excluded: ["acoustic", "country", "slow ballad", "metal"],
    archetypes: {
      intimate: { label: "Mellow Dance", description: "Soft house groove, airy and warm", core: "mellow deep-house pop", energy: "medium", instrumentation: ["soft four-on-the-floor kick", "warm keys", "airy pads"], production: ["smooth club mix"], dynamics: ["gentle groove throughout"], vocal: { m: "intimate_breathy_tenor", f: "clear_expressive_alto" }, delivery: "warm and easy", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      signature: { label: "Dance Pop", description: "Bright synths and a big drop into the chorus", core: "euphoric dance pop", energy: "high", instrumentation: ["four-on-the-floor kick", "bright synth leads", "claps"], production: ["polished club-ready mix"], dynamics: ["build and drop into the chorus"], vocal: { m: "bright_melodic_tenor", f: "powerful_soulful_mezzo" }, delivery: "joyful and energetic", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      expressive: { label: "Festival Dance", description: "Huge festival build-ups", core: "festival dance anthem", energy: "high", instrumentation: ["pounding kick", "supersaw synths", "big risers"], production: ["huge festival mix", "chanted vocal hook"], dynamics: ["massive build before the final chorus"], vocal: { m: "bright_melodic_tenor", f: "powerful_soulful_mezzo" }, delivery: "euphoric and powerful", params: { styleWeight: 0.65, weirdness: 0.3, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Celebratory, a repetitive hook, the name chanted in the chorus.",
    style: "euphoric dance pop, four on the floor kick, bright synth leads, big build and drop into the chorus, party energy, {vocal} vocal, joyful celebration",
    negativeTags: "acoustic, country, slow ballad, metal",
    vocal: { m: "energetic male", f: "energetic female", any: "energetic" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
  },
  latin_pop: {
    key: "latin_pop",
    label: "Latin Pop",
    tagline: "Warm Latin rhythm and heart",
    identity: "latin pop",
    arrangements: ["celebration", "hook_first_pop", "emotional_ballad"],
    excluded: ["metal", "trap", "lo-fi", "screaming"],
    archetypes: {
      intimate: { label: "Acoustic Latin", description: "Nylon guitar and soft percussion", core: "acoustic latin ballad", energy: "low", instrumentation: ["nylon-string guitar", "soft hand percussion"], production: ["warm intimate mix"], dynamics: ["gentle sway"], vocal: { m: "intimate_breathy_tenor", f: "clear_expressive_alto" }, delivery: "warm and tender", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Latin Pop", description: "Danceable groove with nylon guitar and brass", core: "warm latin pop", energy: "medium", instrumentation: ["nylon guitar", "congas and percussion", "brass stabs"], production: ["bright polished mix"], dynamics: ["danceable groove", "big chorus"], vocal: { m: "bright_melodic_tenor", f: "powerful_soulful_mezzo" }, delivery: "passionate and warm", params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 } },
      expressive: { label: "Fiesta Latin", description: "Full horns and a party finish", core: "festive latin pop", energy: "high", instrumentation: ["full horn section", "timbales", "piano montuno", "bass"], production: ["vibrant live mix", "group backing vocals"], dynamics: ["builds to a fiesta final chorus"], vocal: { m: "soulful_velvet_baritone", f: "powerful_soulful_mezzo" }, delivery: "joyful and passionate", params: { styleWeight: 0.65, weirdness: 0.3, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Warm, rhythmic phrasing. English lyrics unless the brief says otherwise.",
    style: "warm latin pop, nylon guitar, congas and percussion, brass stabs, danceable groove, {vocal} passionate vocal, romantic and festive",
    negativeTags: "metal, trap, lo-fi, screaming",
    vocal: { m: "passionate male", f: "passionate female", any: "passionate" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
  },
  jazz: {
    key: "jazz",
    label: "Jazz",
    tagline: "Classic, elegant, after dark",
    identity: "jazz",
    arrangements: ["emotional_ballad", "storytelling"],
    excluded: ["EDM", "rock guitars", "trap", "autotune"],
    archetypes: {
      intimate: { label: "Piano Jazz Ballad", description: "Solo piano and a smoky vocal", core: "intimate piano jazz ballad", energy: "low", instrumentation: ["solo jazz piano"], production: ["warm late-night room sound"], dynamics: ["slow and tender"], vocal: { m: "jazz_crooner_m", f: "warm_smoky_contralto" }, delivery: "tender and elegant", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      signature: { label: "Jazz Trio", description: "Brushed drums, upright bass and piano", core: "classic jazz ballad", energy: "low", instrumentation: ["brushed drums", "upright bass", "piano trio", "muted trumpet"], production: ["warm vintage mix"], dynamics: ["gentle swing", "muted trumpet solo"], vocal: { m: "jazz_crooner_m", f: "warm_smoky_contralto" }, delivery: "smooth and elegant", params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 } },
      expressive: { label: "Big Band Swing", description: "Swinging horns and a showstopping finish", core: "big band swing", energy: "high", instrumentation: ["big band horns", "swinging drums", "walking bass", "piano"], production: ["vintage big band mix"], dynamics: ["swinging build to a showstopping finale"], vocal: { m: "jazz_crooner_m", f: "powerful_soulful_mezzo" }, delivery: "confident and charming", params: { styleWeight: 0.7, weirdness: 0.25, variety: 2 } },
    },
    moods: {},
    lyricNotes: "Witty, elegant, a little old-fashioned. Longer melodic lines.",
    style: "classic jazz ballad, brushed drums, upright bass, piano trio, muted trumpet, late night lounge, {vocal} crooning vocal, elegant and romantic",
    negativeTags: "EDM, rock guitars, trap, autotune",
    vocal: { m: "smooth male crooner", f: "smoky female", any: "smooth" },
    params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
  },
  lullaby: {
    key: "lullaby",
    label: "Lullaby",
    tagline: "Soft, hushed and soothing",
    identity: "lullaby",
    arrangements: ["lullaby"],
    excluded: ["drums", "bass drop", "electric guitar", "loud", "fast"],
    archetypes: {
      intimate: { label: "Music Box Lullaby", description: "A music box and a hushed voice", core: "gentle music box lullaby", energy: "low", instrumentation: ["music box", "soft pads"], production: ["soft warm mix"], dynamics: ["slow and even"], vocal: { m: "lullaby_hush_m", f: "lullaby_hush_f" }, delivery: "hushed and soothing", params: { styleWeight: 0.8, weirdness: 0.15, variety: 0 } },
      signature: { label: "Gentle Lullaby", description: "Soft guitar and strings, slow and warm", core: "gentle acoustic lullaby", energy: "low", instrumentation: ["soft acoustic guitar", "warm strings", "celesta"], production: ["soft intimate mix"], dynamics: ["slow and even"], vocal: { m: "lullaby_hush_m", f: "soft_intimate_soprano" }, delivery: "tender and soothing", params: { styleWeight: 0.8, weirdness: 0.15, variety: 1 } },
    },
    moods: {},
    lyricNotes: "Short soft words, repetition, present tense. Nothing jarring.",
    style: "gentle lullaby, music box, soft acoustic guitar, warm pads, slow tempo, hushed {vocal} vocal, soothing and tender",
    negativeTags: "drums, bass drop, electric guitar, loud, fast",
    vocal: { m: "soft male", f: "soft female", any: "soft" },
    params: { styleWeight: 0.8, weirdness: 0.15, variety: 0 },
    blueprint: lullabyBlueprint,
  },
};

export const GENRE_LIST = Object.values(GENRES).map((g) => ({ key: g.key, label: g.label, tagline: g.tagline }));

export function getGenre(key: string): Genre {
  return GENRES[key] ?? GENRES.pop;
}

/** Archetypes this genre offers, in preferred generation order. */
export function genreArchetypes(g: Genre): Archetype[] {
  return ARCHETYPE_ORDER.filter((a) => g.archetypes[a]);
}

export const MOODS = ["heartfelt", "funny", "romantic", "celebratory", "nostalgic", "uplifting", "calm"] as const;
export const RELATIONSHIPS = ["partner", "mom", "dad", "grandparent", "sibling", "child", "friend", "coworker", "other"] as const;
export const OCCASIONS = [
  "birthday",
  "anniversary",
  "wedding",
  "valentines",
  "mothers_day",
  "fathers_day",
  "christmas",
  "graduation",
  "new_baby",
  "thank_you",
  "just_because",
] as const;

/** Relationships for which romantic language and romantic production are appropriate. */
export const ROMANTIC_RELATIONSHIPS = new Set(["partner", "wife", "husband", "girlfriend", "boyfriend", "fiance", "fiancee", "spouse"]);
export function isRomanticRelationship(relationship: string): boolean {
  return ROMANTIC_RELATIONSHIPS.has(relationship.trim().toLowerCase());
}

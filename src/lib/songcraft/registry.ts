/**
 * The genre registry. Every Suno style prompt is assembled from here, never from
 * free text, so output is consistent and no artist names ever reach Suno.
 * Bump REGISTRY_VERSION whenever a style string or blueprint changes; every
 * generation records the version it used so you can compare results.
 */
export const REGISTRY_VERSION = "2026-11-09.1";

export type Blueprint = {
  /** Section order. Chorus must appear at least twice. */
  sections: { tag: string; lines: number; note?: string }[];
  /** Target syllables per line, inclusive. */
  syllables: [number, number];
  rhyme: string;
  /** Target song length in seconds for the Suno request. */
  targetDuration: number;
};

export type Genre = {
  key: string;
  label: string;
  tagline: string;
  /** Style text for Suno. {vocal} is replaced with the vocal descriptor. */
  style: string;
  negativeTags: string;
  vocal: { m: string; f: string; any: string };
  params: { styleWeight: number; weirdness: number; variety: 0 | 1 | 2 | 3 | 4 };
  blueprint: Blueprint;
  /** Writing guidance passed to the lyricist. */
  lyricNotes: string;
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

export const GENRES: Record<string, Genre> = {
  pop: {
    key: "pop",
    label: "Pop",
    tagline: "Big, bright, made to sing along",
    style:
      "upbeat modern pop, bright synths, punchy drums, catchy anthemic chorus, polished radio production, {vocal} lead vocal, warm and heartfelt",
    negativeTags: "heavy metal, screaming, distorted guitars, lo-fi noise",
    vocal: { m: "confident male", f: "clear female", any: "clear" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Simple words, big feelings, a chorus people can sing back after one listen.",
  },
  acoustic: {
    key: "acoustic",
    label: "Acoustic",
    tagline: "Intimate guitar and piano",
    style:
      "intimate acoustic ballad, fingerpicked acoustic guitar, soft piano, light strings, gentle dynamics, {vocal} vocal close to the mic, tender and sincere",
    negativeTags: "electronic drums, synths, autotune, heavy bass",
    vocal: { m: "warm male", f: "soft female", any: "warm" },
    params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Conversational, specific, small details carry the emotion. Avoid cliches.",
  },
  country: {
    key: "country",
    label: "Country",
    tagline: "Warm Southern storytelling",
    style:
      "modern country, acoustic and electric guitar, pedal steel, steady drums, storytelling verses, big singalong chorus, {vocal} vocal with a slight twang, warm and nostalgic",
    negativeTags: "EDM, trap, rap, heavy metal",
    vocal: { m: "rich male", f: "bright female", any: "warm" },
    params: { styleWeight: 0.7, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Tell it like a story. Places, trucks, kitchens, roads, porches. Concrete nouns.",
  },
  rnb: {
    key: "rnb",
    label: "R&B",
    tagline: "Smooth, groovy and romantic",
    style:
      "smooth contemporary R&B, laid-back groove, warm electric piano, deep bass, soft snaps, lush harmonies, {vocal} vocal with runs and ad-libs, romantic and soulful",
    negativeTags: "rock, country, metal, screaming",
    vocal: { m: "silky male", f: "sultry female", any: "silky" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Smooth phrasing, room for runs. Repetition of a short hook works well.",
  },
  hiphop: {
    key: "hiphop",
    label: "Hip-Hop",
    tagline: "Boom-bap beats, real rap",
    style:
      "boom bap hip hop, punchy drums, warm sampled keys, head-nodding groove, {vocal} rapper with clear confident flow, playful and celebratory, sung melodic hook",
    negativeTags: "country, metal, acoustic ballad, slow tempo",
    vocal: { m: "male", f: "female", any: "" },
    params: { styleWeight: 0.7, weirdness: 0.3, variety: 1 },
    blueprint: rapBlueprint,
    lyricNotes: "Rhythmic, witty, dense with specifics. Clean language. The hook is sung and simple.",
  },
  rock: {
    key: "rock",
    label: "Rock",
    tagline: "Loud guitars, big choruses",
    style:
      "anthemic rock, driving electric guitars, big drums, soaring chorus, stadium energy, {vocal} powerful vocal, triumphant and heartfelt",
    negativeTags: "EDM, trap, lo-fi, whispering",
    vocal: { m: "gritty male", f: "powerful female", any: "powerful" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Short punchy lines. A chorus you can shout.",
  },
  soul_gospel: {
    key: "soul_gospel",
    label: "Soul & Gospel",
    tagline: "Warm organ, powerful voices",
    style:
      "uplifting soul gospel, Hammond organ, live drums, hand claps, full choir backing vocals, building dynamics, {vocal} lead vocal full of feeling, grateful and joyful",
    negativeTags: "EDM, trap, metal, autotune",
    vocal: { m: "rich male", f: "powerhouse female", any: "powerful" },
    params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Gratitude and uplift. Call and response in the chorus is welcome.",
  },
  indie_pop: {
    key: "indie_pop",
    label: "Indie Pop",
    tagline: "Warm, dreamy, a little retro",
    style:
      "dreamy indie pop, jangly guitars, warm analog synths, soft drums, nostalgic and sunny, {vocal} breathy vocal, intimate and charming",
    negativeTags: "metal, trap, EDM drops, screaming",
    vocal: { m: "soft male", f: "airy female", any: "soft" },
    params: { styleWeight: 0.65, weirdness: 0.3, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Quirky details welcome. Understated emotion.",
  },
  dance_pop: {
    key: "dance_pop",
    label: "Dance Pop",
    tagline: "Feel-good dance-floor beats",
    style:
      "euphoric dance pop, four on the floor kick, bright synth leads, big build and drop into the chorus, party energy, {vocal} vocal, joyful celebration",
    negativeTags: "acoustic, country, slow ballad, metal",
    vocal: { m: "energetic male", f: "energetic female", any: "energetic" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Celebratory, repetitive hook, the name chanted in the chorus.",
  },
  latin_pop: {
    key: "latin_pop",
    label: "Latin Pop",
    tagline: "Warm Latin rhythm and heart",
    style:
      "warm latin pop, nylon guitar, congas and percussion, brass stabs, danceable groove, {vocal} passionate vocal, romantic and festive",
    negativeTags: "metal, trap, lo-fi, screaming",
    vocal: { m: "passionate male", f: "passionate female", any: "passionate" },
    params: { styleWeight: 0.7, weirdness: 0.25, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Warm, rhythmic phrasing. English lyrics unless the brief says otherwise.",
  },
  jazz: {
    key: "jazz",
    label: "Jazz",
    tagline: "Classic, elegant, after dark",
    style:
      "classic jazz ballad, brushed drums, upright bass, piano trio, muted trumpet, late night lounge, {vocal} crooning vocal, elegant and romantic",
    negativeTags: "EDM, rock guitars, trap, autotune",
    vocal: { m: "smooth male crooner", f: "smoky female", any: "smooth" },
    params: { styleWeight: 0.75, weirdness: 0.2, variety: 1 },
    blueprint: standardBlueprint,
    lyricNotes: "Witty, elegant, a little old-fashioned. Longer melodic lines.",
  },
  lullaby: {
    key: "lullaby",
    label: "Lullaby",
    tagline: "Soft, hushed and soothing",
    style:
      "gentle lullaby, music box, soft acoustic guitar, warm pads, slow tempo, hushed {vocal} vocal, soothing and tender",
    negativeTags: "drums, bass drop, electric guitar, loud, fast",
    vocal: { m: "soft male", f: "soft female", any: "soft" },
    params: { styleWeight: 0.8, weirdness: 0.15, variety: 0 },
    blueprint: lullabyBlueprint,
    lyricNotes: "Short soft words, repetition, present tense. Nothing jarring.",
  },
};

export const GENRE_LIST = Object.values(GENRES).map((g) => ({ key: g.key, label: g.label, tagline: g.tagline }));

export function getGenre(key: string): Genre {
  return GENRES[key] ?? GENRES.pop;
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

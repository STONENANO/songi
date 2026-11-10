/**
 * Arrangement variants: the shape of a song. Each genre allows a short list;
 * deterministic rules pick a default, and the lyric writer may choose another
 * from the allowed list when the story calls for it.
 */

export type ArrangementId = "storytelling" | "emotional_ballad" | "celebration" | "hook_first_pop" | "lullaby" | "rhythmic_rap";

export type SectionSpec = {
  tag: string;
  minLines: number;
  maxLines: number;
  purpose: string;
  optional?: boolean;
};

export type Arrangement = {
  id: ArrangementId;
  label: string;
  sections: SectionSpec[];
  /** Target syllables per line, inclusive. A guide for rhythm, not a hard rule. */
  syllables: [number, number];
  dynamics: string;
  chorus: {
    /** "identical": every chorus word for word. "final_may_lift": the last chorus may change one or two lines. */
    repeat: "identical" | "final_may_lift";
    nameRule: "first_two_lines";
  };
  /** Recommended duration range in seconds. */
  duration: [number, number];
  /** Typical sung words per second, for duration estimates. */
  vocalDensity: number;
  /** Typical instrumental time (intro, breaks, outro) in seconds. */
  instrumentalSeconds: number;
  notes: string;
};

const CHORUS = "The hook: one central idea, concise, memorable after one listen. Recipient's name in line 1 or 2.";

export const ARRANGEMENTS: Record<ArrangementId, Arrangement> = {
  storytelling: {
    id: "storytelling",
    label: "Storytelling",
    sections: [
      { tag: "Verse 1", minLines: 4, maxLines: 6, purpose: "Open on a specific, recognisable moment or habit. Set the scene with real detail." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: CHORUS },
      { tag: "Verse 2", minLines: 4, maxLines: 6, purpose: "Deepen the meaning with a second specific detail; show what it says about them." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Bridge", minLines: 2, maxLines: 4, purpose: "Shift perspective: gratitude, a realisation, the inside joke, or a wish." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Final chorus; may change one or two lines to land the story's turn." },
      { tag: "Outro", minLines: 1, maxLines: 2, purpose: "Short callback that lands on the name or the hook." },
    ],
    syllables: [6, 11],
    dynamics: "Conversational verses, a lift into each chorus, a quieter bridge, a full final chorus.",
    chorus: { repeat: "final_may_lift", nameRule: "first_two_lines" },
    duration: [150, 215],
    vocalDensity: 1.7,
    instrumentalSeconds: 35,
    notes: "Narrative order follows the story's own logic; never invent a chronology.",
  },
  emotional_ballad: {
    id: "emotional_ballad",
    label: "Emotional ballad",
    sections: [
      { tag: "Verse 1", minLines: 4, maxLines: 4, purpose: "Intimate opening: speak directly to them about one real detail." },
      { tag: "Pre-Chorus", minLines: 2, maxLines: 2, purpose: "Build tension toward the hook.", optional: true },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: CHORUS },
      { tag: "Verse 2", minLines: 4, maxLines: 4, purpose: "A second detail that shows why it matters." },
      { tag: "Pre-Chorus", minLines: 2, maxLines: 2, purpose: "Same build as before.", optional: true },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Bridge", minLines: 2, maxLines: 4, purpose: "The emotional peak: the thing that is hardest to say out loud." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Final chorus; may lift one or two lines to resolve the story." },
      { tag: "Outro", minLines: 1, maxLines: 2, purpose: "Quiet ending on the name or a callback." },
    ],
    syllables: [5, 10],
    dynamics: "Starts close and quiet, builds through the bridge, biggest moment in the final chorus, soft ending.",
    chorus: { repeat: "final_may_lift", nameRule: "first_two_lines" },
    duration: [165, 225],
    vocalDensity: 1.35,
    instrumentalSeconds: 40,
    notes: "Leave space. Fewer, longer-held words beat crowded lines.",
  },
  celebration: {
    id: "celebration",
    label: "Celebration",
    sections: [
      { tag: "Intro", minLines: 1, maxLines: 2, purpose: "A short shout-out or chant.", optional: true },
      { tag: "Verse 1", minLines: 4, maxLines: 4, purpose: "Celebrate them with a specific, upbeat detail." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: CHORUS + " Easy for a room to sing along." },
      { tag: "Verse 2", minLines: 4, maxLines: 4, purpose: "Another detail, playful or proud." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Bridge", minLines: 2, maxLines: 2, purpose: "A toast, a wish, or the inside joke." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Final chorus; may change one or two lines to land the story's turn." },
      { tag: "Outro", minLines: 1, maxLines: 2, purpose: "Happy ending on the name." },
    ],
    syllables: [5, 10],
    dynamics: "High energy from the start, a breakdown at the bridge, big final chorus.",
    chorus: { repeat: "final_may_lift", nameRule: "first_two_lines" },
    duration: [140, 195],
    vocalDensity: 1.9,
    instrumentalSeconds: 30,
    notes: "Short punchy lines; repetition is a feature in the chorus.",
  },
  hook_first_pop: {
    id: "hook_first_pop",
    label: "Hook-first pop",
    sections: [
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Open with the hook. " + CHORUS },
      { tag: "Verse 1", minLines: 4, maxLines: 4, purpose: "The detail that earns the hook." },
      { tag: "Pre-Chorus", minLines: 2, maxLines: 2, purpose: "Lift into the chorus.", optional: true },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Verse 2", minLines: 4, maxLines: 4, purpose: "A second detail with a new angle." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Bridge", minLines: 2, maxLines: 4, purpose: "Contrast: a quieter, more personal moment." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Final chorus; may lift one or two lines." },
      { tag: "Outro", minLines: 1, maxLines: 2, purpose: "Tag the hook.", optional: true },
    ],
    syllables: [5, 10],
    dynamics: "Hook up front, tight verses, a breakdown bridge, big last chorus.",
    chorus: { repeat: "final_may_lift", nameRule: "first_two_lines" },
    duration: [150, 205],
    vocalDensity: 1.9,
    instrumentalSeconds: 25,
    notes: "The chorus carries the song; spend most of the craft there.",
  },
  lullaby: {
    id: "lullaby",
    label: "Lullaby",
    sections: [
      { tag: "Verse 1", minLines: 4, maxLines: 4, purpose: "Soft, present tense, one tender real detail." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "A gentle refrain with the name, like a promise." },
      { tag: "Verse 2", minLines: 4, maxLines: 4, purpose: "Another small, real detail." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Outro", minLines: 2, maxLines: 2, purpose: "Trail off on the name." },
    ],
    syllables: [4, 8],
    dynamics: "Even, slow and soft throughout; nothing sudden.",
    chorus: { repeat: "identical", nameRule: "first_two_lines" },
    duration: [120, 175],
    vocalDensity: 1.1,
    instrumentalSeconds: 35,
    notes: "Short soft words, repetition, no jarring images.",
  },
  rhythmic_rap: {
    id: "rhythmic_rap",
    label: "Rhythmic rap",
    sections: [
      { tag: "Intro", minLines: 1, maxLines: 2, purpose: "A shout-out to the recipient." },
      { tag: "Verse 1", minLines: 8, maxLines: 12, purpose: "Dense with real detail, internal rhyme, clear story." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "A sung or chanted hook with the name. Simple and catchy." },
      { tag: "Verse 2", minLines: 8, maxLines: 12, purpose: "More detail, the inside joke, a proud payoff." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Repeat the chorus word for word." },
      { tag: "Bridge", minLines: 2, maxLines: 4, purpose: "Half-time breakdown: drop the hype for the one sincere thing under it." },
      { tag: "Chorus", minLines: 4, maxLines: 4, purpose: "Final chorus; may change one or two lines to land the turn." },
      { tag: "Outro", minLines: 1, maxLines: 2, purpose: "Land on the name." },
    ],
    syllables: [9, 15],
    dynamics: "Steady groove, verses ride the beat, the hook opens up melodically.",
    chorus: { repeat: "final_may_lift", nameRule: "first_two_lines" },
    duration: [140, 200],
    vocalDensity: 2.6,
    instrumentalSeconds: 25,
    notes: "Clean language. Rhythm and wordplay over forced end-rhymes.",
  },
};

export type SelectionContext = { occasion: string; mood: string | null; factCount: number };

/** Pick the default arrangement from the genre's allowed list using simple, explainable rules. */
export function selectArrangement(allowed: ArrangementId[], ctx: SelectionContext): { defaultId: ArrangementId; allowed: ArrangementId[]; reason: string } {
  const has = (id: ArrangementId) => allowed.includes(id);
  const mood = (ctx.mood ?? "").toLowerCase();
  const occasion = ctx.occasion.toLowerCase();
  const upbeat = ["celebratory", "funny"].includes(mood) || (["birthday", "graduation", "congratulations"].some((o) => occasion.includes(o)) && !["heartfelt", "nostalgic", "calm", "romantic"].includes(mood));
  const tender = ["heartfelt", "nostalgic", "calm", "romantic", "uplifting"].includes(mood) || ["wedding", "anniversary", "new_baby", "thank_you"].some((o) => occasion.includes(o));

  if (allowed.length === 1) return { defaultId: allowed[0], allowed, reason: "only arrangement for this genre" };
  if (upbeat && has("celebration")) return { defaultId: "celebration", allowed, reason: "upbeat occasion or mood" };
  if (tender && has("emotional_ballad")) return { defaultId: "emotional_ballad", allowed, reason: "tender occasion or mood" };
  if (ctx.factCount >= 4 && has("storytelling")) return { defaultId: "storytelling", allowed, reason: "rich story with several details" };
  if (upbeat && has("hook_first_pop")) return { defaultId: "hook_first_pop", allowed, reason: "upbeat and hook-driven" };
  return { defaultId: allowed[0], allowed, reason: "genre default" };
}

export function describeArrangement(a: Arrangement): string {
  return [
    `${a.id} (${a.label}). ${a.dynamics} ${a.notes}`,
    `Syllables per line: about ${a.syllables[0]} to ${a.syllables[1]}. Chorus: ${a.chorus.repeat === "identical" ? "every chorus word for word" : "repeat word for word; the final chorus may lift one or two lines"}.`,
    ...a.sections.map((s) => `- ${s.tag}${s.optional ? " (optional)" : ""}: ${s.minLines === s.maxLines ? s.minLines : `${s.minLines}-${s.maxLines}`} lines. ${s.purpose}`),
  ].join("\n");
}

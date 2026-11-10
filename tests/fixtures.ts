import type { Brief, BriefFact, Lyrics, VerifierReport } from "../src/lib/songcraft";

export function fact(id: string, text: string, priority: 1 | 2 | 3 = 1, extra: Partial<BriefFact> = {}): BriefFact {
  return { id, type: "memory", text, priority, sourceQuote: text, sourceRef: null, provenance: "verified", emotionalMeaning: "", narrativeRole: "relationship_evidence", ...extra };
}

export function brief(over: Partial<Brief> = {}): Brief {
  return {
    briefVersion: 2,
    recipient: { name: "Linda", sungAs: "", relationship: "mom", pronouns: "she", nicknames: [] },
    giverName: "",
    occasion: "birthday",
    facts: [fact("fact_01", "Taught me to make pancakes every Sunday"), fact("fact_02", "Sings off-key in the car", 1), fact("fact_03", "Loves the lake house in Michigan", 2)],
    omittedFacts: [],
    emotionalThesis: "You made ordinary days feel like home.",
    signaturePhrases: [],
    narrativeArc: [],
    contradictions: [],
    tone: ["warm"],
    mustInclude: ["Linda"],
    avoid: ["romantic language"],
    summary: "",
    followUpQuestions: [],
    provenanceNotes: [],
    ...over,
  };
}

const chorus = ["Linda, you're the song in the car", "Off-key and loud and right where you are", "Every Sunday you made it home", "Linda, you're never alone"];

/** A valid storytelling-arrangement lyric sheet for brief(). */
export function goodLyrics(over: Partial<Lyrics> = {}): Lyrics {
  return {
    plan: { thesis: "", centralDetail: "", payoff: "", hookConcept: "", verseRoles: [], ending: "" },
    arrangementId: "storytelling",
    title: "Linda, the Song in the Car",
    sections: [
      { tag: "Verse 1", lines: ["Sunday morning, batter in the pan", "You taught me pancakes with a steady hand", "The kitchen warm before the sun", "I still make them like you've done"] },
      { tag: "Chorus", lines: [...chorus] },
      { tag: "Verse 2", lines: ["Up at the lake house in Michigan", "You'd sing off-key and sing again", "The windows down, the radio loud", "You never cared about the crowd"] },
      { tag: "Chorus", lines: [...chorus] },
      { tag: "Bridge", lines: ["So here's my thank you, plain and true", "Every good thing started with you"] },
      { tag: "Chorus", lines: [...chorus] },
      { tag: "Outro", lines: ["Happy birthday, Linda"] },
    ],
    factPlacement: [
      { factId: "fact_01", line: "You taught me pancakes with a steady hand" },
      { factId: "fact_02", line: "You'd sing off-key and sing again" },
    ],
    namePlacementNote: "",
    ...over,
  };
}

export function report(over: Partial<VerifierReport["factual"]> = {}, rest: Partial<VerifierReport> = {}): VerifierReport {
  const s = (score: number) => ({ score, why: "" });
  return {
    factual: {
      pass: true,
      coverage: [
        { factId: "fact_01", covered: true, evidence: "" },
        { factId: "fact_02", covered: true, evidence: "" },
      ],
      inventedDetails: [],
      identityOk: true,
      relationshipOk: true,
      constraintViolations: [],
      ...over,
    },
    issues: [],
    scores: { emotionalImpact: s(7), personalSpecificity: s(7), hookMemorability: s(7), singability: s(7), genreFit: s(7) },
    sectionsToRepair: [],
    summary: "",
    ...rest,
  };
}

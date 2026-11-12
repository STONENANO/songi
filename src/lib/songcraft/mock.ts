/**
 * Deterministic stand-ins for the LLM so the pipeline runs with no API key.
 * They are intentionally simple; they exist to exercise the plumbing, not to
 * write good songs.
 */
import type { Brief, Lyrics, QuizInput, VerifierReport } from "./types";
import type { Genre } from "./registry";

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function mockBrief(input: QuizInput): Brief {
  const answers = Object.values(input.followUpAnswers ?? {}).join(" ");
  // Structured quiz stories arrive as Q/A blocks; keep only the answers.
  const story = input.story.replace(/^Q:.*$/gm, "").replace(/^A:\s*/gm, "").replace(/^What I most want the song to say:\s*/gm, "");
  const facts = sentences(`${story} ${answers}`).slice(0, 8).map((s, i) => ({
    type: /kitchen|house|lake|town|beach|road|park/i.test(s)
      ? ("place" as const)
      : /always|never|every/i.test(s)
        ? ("trait" as const)
        : ("memory" as const),
    text: s.replace(/[.!?]$/, ""),
    priority: (i < 3 ? 1 : i < 6 ? 2 : 3) as 1 | 2 | 3,
  }));
  const name = input.recipientName?.trim() || "";
  const followUps =
    facts.length < 3 && !input.followUpAnswers
      ? [
          `What is one specific memory with ${name || "them"} that always makes you smile?`,
          `What is something ${name || "they"} always says or does that is so them?`,
        ]
      : [];
  return {
    recipient: {
      name,
      sungAs: input.pronunciation?.trim() || "",
      relationship: input.relationship,
      pronouns: /mom|grandma|girlfriend|wife|sister|daughter/i.test(input.relationship) ? "she" : /dad|grandpa|boyfriend|husband|brother|son/i.test(input.relationship) ? "he" : "they",
    },
    giverName: "",
    occasion: input.occasion.replace(/_/g, " "),
    facts,
    tone: [input.mood ?? "heartfelt", "warm"],
    mustInclude: name ? [name] : [],
    avoid: /mom|dad|grand|child|friend|cowork/i.test(input.relationship) ? ["romantic language"] : [],
    summary: `A ${input.genreKey} song for ${name || input.relationship} for their ${input.occasion.replace(/_/g, " ")}.`,
    followUpQuestions: followUps,
  };
}

export function mockLyrics(brief: Brief, genre: Genre): Lyrics {
  const name = brief.recipient.name || "you";
  const f = (i: number) => brief.facts[i % Math.max(brief.facts.length, 1)]?.text ?? "the little things you do";
  const chorus = [
    `${name}, this one is for you`,
    `Every ${brief.occasion} I think of all you do`,
    `Through the years you have been my light`,
    `${name}, tonight we sing it right`,
  ];
  const sections = genre.blueprint.sections.map((s) => {
    if (s.tag === "Chorus") return { tag: s.tag, lines: chorus };
    if (s.tag.startsWith("Verse")) {
      const base = s.tag === "Verse 1" ? 0 : 2;
      const lines = [
        `I remember ${f(base).toLowerCase()}`,
        `The way it felt, the way it still does`,
        `And ${f(base + 1).toLowerCase()}`,
        `That is the kind of love this is`,
      ];
      return { tag: s.tag, lines: lines.slice(0, s.lines) };
    }
    if (s.tag === "Bridge") return { tag: s.tag, lines: [`So here is to you, ${name}`, `For all you are and all you do`] };
    if (s.tag === "Intro") return { tag: s.tag, lines: [`Yeah, this one goes out to ${name}`, `Turn it up`] };
    return { tag: s.tag, lines: [`Happy ${brief.occasion}, ${name}`, `We love you`] };
  });
  return {
    title: `${name}, This One Is For You`.slice(0, 60),
    sections,
    factPlacement: brief.facts.slice(0, 4).map((fact, i) => ({ fact: fact.text, line: `I remember ${f(i).toLowerCase()}` })),
  };
}

export function mockVerify(brief: Brief, lyrics: Lyrics): VerifierReport {
  const text = lyrics.sections.flatMap((s) => s.lines).join("\n").toLowerCase();
  const chorus = lyrics.sections.find((s) => s.tag === "Chorus")?.lines.join(" ").toLowerCase() ?? "";
  const name = brief.recipient.name.toLowerCase();
  const factCoverage = brief.facts.map((f) => {
    const key = f.text.toLowerCase().split(" ").slice(0, 4).join(" ");
    const covered = text.includes(key);
    return { fact: f.text, covered, evidence: covered ? key : "" };
  });
  const nameInChorus = !name || chorus.includes(name);
  const issues = [];
  if (!nameInChorus) issues.push({ severity: "error" as const, message: "Recipient name missing from chorus." });
  const uncoveredP1 = factCoverage.filter((c, i) => !c.covered && brief.facts[i].priority === 1);
  if (uncoveredP1.length) issues.push({ severity: "warning" as const, message: `${uncoveredP1.length} priority-1 fact(s) not clearly covered.` });
  return {
    pass: !issues.some((i) => i.severity === "error"),
    factCoverage,
    inventedDetails: [],
    nameInChorus,
    issues,
    repairInstructions: nameInChorus ? "" : "Put the recipient's name in the first line of the chorus.",
  };
}

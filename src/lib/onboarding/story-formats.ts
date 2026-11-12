/**
 * How each story topic is answered. Copy only, no UI.
 *
 * - "tap":    answer tiles, an optional narrowing chip row, an optional one-line detail.
 *             For factual topics (how you met, places, traditions).
 * - "blanks": a fill-in-the-blank story card with suggestions per blank.
 *             For emotional topics (the moment you knew, what they always say).
 * - "open":   a free text box ("Something else").
 *
 * Templates use {name}, {they}, {them}, {their} (and capitalised forms); see fill() in content.ts.
 * Every answer becomes one plain "story beat" the buyer confirms before we write.
 */
import { fill, type Pronoun } from "./content";

export type TapAnswer = { emoji: string; label: string };
export type TapFormat = {
  kind: "tap";
  answers: TapAnswer[];
  /** Second, smaller chip row. Keyed by answer label, or "*" for every answer. */
  followLabel?: string;
  follow?: Record<string, string[]>;
  /** Placeholder for the optional one-line detail. */
  detail: string;
};
export type BlankSpec = { label: string; sugg: string[] };
export type BlanksFormat = {
  kind: "blanks";
  /** Each sentence is text pieces and blank indexes. A sentence with an unfilled blank is left out of the beat. */
  sentences: (string | number)[][];
  blanks: BlankSpec[];
};
export type OpenFormat = { kind: "open"; placeholder: string };
export type StoryFormat = TapFormat | BlanksFormat | OpenFormat;

export const OTHER_ANSWER = "Something else";
const other: TapAnswer = { emoji: "✏️", label: OTHER_ANSWER };

const FORMATS: Record<string, StoryFormat> = {
  how_met: {
    kind: "tap",
    answers: [{ emoji: "🏫", label: "At school" }, { emoji: "💼", label: "At work" }, { emoji: "📱", label: "Online" }, { emoji: "👯", label: "Through friends" }, { emoji: "🎉", label: "At a party" }, other],
    followLabel: "Where exactly?",
    follow: {
      "At school": ["High school", "College", "Middle school", "Grad school"],
      "At work": ["Same team", "Different teams", "A client", "A work trip"],
      Online: ["Dating app", "Social media", "A game", "A group chat"],
      "Through friends": ["A friend set us up", "A birthday", "A wedding", "A group trip"],
      "At a party": ["House party", "A wedding", "New Year's", "A club"],
    },
    detail: "What happened that day? e.g. {they} sat behind me and kicked my chair",
  },
  laugh: {
    kind: "tap",
    answers: [{ emoji: "📣", label: "Loud and contagious" }, { emoji: "🐷", label: "{They} snorts" }, { emoji: "🤭", label: "Quiet giggle" }, { emoji: "😶", label: "Silent shaking" }, { emoji: "🎶", label: "Like a song" }, other],
    followLabel: "When does it come out most?",
    follow: { "*": ["At my jokes", "At {their} own jokes", "At movies", "When {they}'s tired", "At the worst moments"] },
    detail: "A time {they} couldn't stop laughing",
  },
  places: {
    kind: "tap",
    answers: [{ emoji: "🏖️", label: "The beach" }, { emoji: "🏡", label: "Our home" }, { emoji: "🍽️", label: "A restaurant" }, { emoji: "🌲", label: "Outdoors" }, { emoji: "🚗", label: "On the road" }, other],
    followLabel: "What do you do there?",
    follow: { "*": ["Talk for hours", "Eat too much", "Dance", "Watch the sunset", "Nothing at all"] },
    detail: "Name the place, e.g. Joe's Diner on 5th",
  },
  kids_family: {
    kind: "tap",
    answers: [{ emoji: "🧸", label: "Playful" }, { emoji: "🛡️", label: "Protective" }, { emoji: "🍳", label: "Feeds everyone" }, { emoji: "🎉", label: "Life of the party" }, { emoji: "🤗", label: "The glue" }, other],
    followLabel: "When do you see it most?",
    follow: { "*": ["Sunday dinners", "Holidays", "Bedtime", "Road trips", "Hard days"] },
    detail: "One small moment that shows it",
  },
  little_things: {
    kind: "tap",
    answers: [{ emoji: "☕", label: "Morning coffee" }, { emoji: "🎶", label: "Humming and singing" }, { emoji: "📝", label: "Little notes" }, { emoji: "🧺", label: "Taking care of things" }, { emoji: "😴", label: "Sleepy habits" }, other],
    followLabel: "When?",
    follow: { "*": ["Every morning", "Every night", "When I'm down", "Without being asked"] },
    detail: "Describe it, e.g. {they} hums while cooking",
  },
  future: {
    kind: "tap",
    answers: [{ emoji: "✈️", label: "A big trip" }, { emoji: "🏡", label: "A home" }, { emoji: "👶", label: "A family" }, { emoji: "💍", label: "Getting married" }, { emoji: "👵", label: "Growing old together" }, other],
    followLabel: "When?",
    follow: { "*": ["Soon", "Someday", "We're already planning it"] },
    detail: "Where or what exactly?",
  },
  childhood: {
    kind: "tap",
    answers: [{ emoji: "🍳", label: "In the kitchen" }, { emoji: "🚗", label: "Road trips" }, { emoji: "🎄", label: "Holidays" }, { emoji: "🌙", label: "Bedtime" }, { emoji: "⚽", label: "Games and sports" }, other],
    followLabel: "What did {they} do?",
    follow: { "*": ["Made us laugh", "Sang to us", "Taught me something", "Cooked my favourite", "Always showed up"] },
    detail: "One detail you still remember",
  },
  taught_me: {
    kind: "tap",
    answers: [{ emoji: "🚲", label: "To ride a bike" }, { emoji: "🍳", label: "To cook" }, { emoji: "🎣", label: "To fish" }, { emoji: "💪", label: "To be strong" }, { emoji: "💛", label: "To be kind" }, other],
    followLabel: "When did you learn it?",
    follow: { "*": ["When I was little", "As a teenager", "As an adult", "Still learning"] },
    detail: "What {they} used to say while teaching you",
  },
  gives: {
    kind: "tap",
    answers: [{ emoji: "🚗", label: "Rides everywhere" }, { emoji: "🍲", label: "Feeds everyone" }, { emoji: "📞", label: "Always calls" }, { emoji: "🧰", label: "Fixes everything" }, { emoji: "🎁", label: "Gives without asking" }, other],
    followLabel: "For who?",
    follow: { "*": ["Me", "Our family", "Friends", "Strangers", "Everyone"] },
    detail: "One time it really mattered",
  },
  traditions: {
    kind: "tap",
    answers: [{ emoji: "🍝", label: "Sunday dinners" }, { emoji: "🎄", label: "Holidays" }, { emoji: "🎂", label: "Birthdays" }, { emoji: "🚗", label: "Road trips" }, { emoji: "🎬", label: "Movie nights" }, other],
    followLabel: "How long?",
    follow: { "*": ["Every week", "Every year", "Since I was little", "Since we met"] },
    detail: "What always happens? e.g. {they} burns the first pancake",
  },

  moment_knew: {
    kind: "blanks",
    sentences: [["I knew {name} was the one when ", 0, "."], ["We were ", 1, "."], ["I remember feeling ", 2, "."]],
    blanks: [
      { label: "When did you know?", sugg: ["{they} laughed at my worst joke", "{they} stayed up all night with me", "{they} met my family", "{they} held my hand"] },
      { label: "Where were you?", sugg: ["at home", "in the car", "on our first trip", "at a friend's wedding"] },
      { label: "How did it feel?", sugg: ["safe", "at home", "like the luckiest person alive", "calm for the first time"] },
    ],
  },
  sayings: {
    kind: "blanks",
    sentences: [["{name} always says ", 0, "."], ["{They} says it whenever ", 1, "."], ["It makes me feel ", 2, "."]],
    blanks: [
      { label: "{Their} exact words", sugg: ["“we got this”", "“drive safe”", "“I love you more”", "“one more episode”"] },
      { label: "When does {they} say it?", sugg: ["things get hard", "I leave the house", "we're up too late", "I doubt myself"] },
      { label: "How does it make you feel?", sugg: ["safe", "loved", "like I can do anything", "like laughing"] },
    ],
  },
  hard_time: {
    kind: "blanks",
    sentences: [["When ", 0, ", {name} ", 1, "."], ["Because of {them}, I ", 2, "."]],
    blanks: [
      { label: "What happened?", sugg: ["I lost my job", "I was sick", "we lost someone", "I moved far away"] },
      { label: "What did {they} do?", sugg: ["never left my side", "made me laugh again", "took care of everything", "believed in me"] },
      { label: "What did it give you?", sugg: ["got through it", "found my way back", "learned to be brave", "know I'm never alone"] },
    ],
  },
  inside_joke: {
    kind: "blanks",
    sentences: [["Only we get why ", 0, " is funny."], ["It started when ", 1, "."]],
    blanks: [
      { label: "The word or thing", sugg: ["“the thing”", "pineapple", "that one song", "the duck"] },
      { label: "How did it start?", sugg: ["we got lost", "{they} mispronounced it", "a waiter said it", "we were kids"] },
    ],
  },
  proud: {
    kind: "blanks",
    sentences: [["I'm so proud of how {name} ", 0, "."], ["I watched {them} ", 1, "."]],
    blanks: [
      { label: "What are you proud of?", sugg: ["never gave up", "became a parent", "started over", "takes care of everyone"] },
      { label: "What did you see?", sugg: ["graduate", "work two jobs", "fight through it", "grow up so fast"] },
    ],
  },
  memory: {
    kind: "blanks",
    sentences: [["My favourite memory with {name} is ", 0, "."], ["We were ", 1, ", and {they} ", 2, "."]],
    blanks: [
      { label: "Which memory?", sugg: ["our first trip", "the day we met", "a lazy Sunday", "our wedding day"] },
      { label: "Where were you?", sugg: ["at the beach", "in the car", "at home", "on vacation"] },
      { label: "What did {they} do?", sugg: ["couldn't stop laughing", "held my hand", "danced like no one was watching", "sang the whole way"] },
    ],
  },

  something_else: { kind: "open", placeholder: "I want the song to mention…" },
};

export function formatFor(threadKey: string): StoryFormat {
  return FORMATS[threadKey] ?? { kind: "open", placeholder: "Tell us in your own words…" };
}

/** What the buyer has entered for one topic. */
export type TopicAnswer = { choice?: string; other?: string; follow?: string; detail?: string; blanks?: string[]; text?: string };

export function isAnswered(fmt: StoryFormat, a: TopicAnswer | undefined): boolean {
  if (!a) return false;
  if (fmt.kind === "tap") return !!a.choice && (a.choice !== OTHER_ANSWER || (a.other ?? "").trim().length > 1);
  if (fmt.kind === "blanks") return (a.blanks ?? []).some((b) => b.trim());
  return (a.text ?? "").trim().length >= 10;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The plain sentence we read back to the buyer for one topic. This is also what the
 * songwriter receives (after the buyer confirms or edits it), so it uses their words.
 */
export function beatFor(fmt: StoryFormat, topicLabel: string, a: TopicAnswer, name: string, pronoun: Pronoun): string {
  const f = (t: string) => fill(t, name, pronoun);
  if (fmt.kind === "tap") {
    const choice = a.choice === OTHER_ANSWER ? (a.other ?? "").trim() : f(a.choice ?? "");
    const detail = (a.detail ?? "").trim().replace(/\.$/, "");
    return `${topicLabel}: ${choice}${a.follow ? `, ${lower(f(a.follow))}` : ""}.${detail ? ` In your words: “${detail}.”` : ""}`;
  }
  if (fmt.kind === "blanks") {
    const vals = a.blanks ?? [];
    return fmt.sentences
      .filter((s) => s.every((p) => typeof p !== "number" || (vals[p] ?? "").trim()))
      .map((s) => s.map((p) => (typeof p === "number" ? vals[p].trim() : f(p))).join(""))
      .join(" ");
  }
  return (a.text ?? "").trim();
}

/** Short chips for the ingredients tray. */
export function ingredientsFor(fmt: StoryFormat, a: TopicAnswer | undefined, name: string, pronoun: Pronoun): string[] {
  if (!a) return [];
  const f = (t: string) => fill(t, name, pronoun);
  if (fmt.kind === "tap") {
    const main = a.choice === OTHER_ANSWER ? (a.other ?? "").trim() : a.choice ? f(a.choice) : "";
    return [a.follow ? f(a.follow) : main, (a.detail ?? "").trim().split(/\s+/).slice(0, 5).join(" ")].filter(Boolean);
  }
  if (fmt.kind === "blanks") return (a.blanks ?? []).map((b) => b.trim().replace(/[“”"]/g, "")).filter(Boolean);
  return [(a.text ?? "").trim().split(/\s+/).slice(0, 5).join(" ")].filter(Boolean);
}

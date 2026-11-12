/**
 * Everything the story quiz says. Copy lives here, not in the components,
 * so it can be tuned without touching layout code.
 *
 * Placeholders in question text: {name} = recipient name, {they}/{them}/{their}
 * = pronouns, {You} etc. are not used.
 */

export type Pronoun = "she" | "he" | "they";
export type Group = "partner" | "parent" | "grandparent" | "child" | "sibling" | "friend" | "other";

export type Relationship = { value: string; label: string; emoji: string; pronoun: Pronoun; group: Group };

export const RELATIONSHIPS: Relationship[] = [
  { value: "wife", label: "Wife", emoji: "💍", pronoun: "she", group: "partner" },
  { value: "husband", label: "Husband", emoji: "💍", pronoun: "he", group: "partner" },
  { value: "girlfriend", label: "Girlfriend", emoji: "❤️", pronoun: "she", group: "partner" },
  { value: "boyfriend", label: "Boyfriend", emoji: "❤️", pronoun: "he", group: "partner" },
  { value: "mom", label: "Mom", emoji: "🌷", pronoun: "she", group: "parent" },
  { value: "dad", label: "Dad", emoji: "🧢", pronoun: "he", group: "parent" },
  { value: "grandma", label: "Grandma", emoji: "🧶", pronoun: "she", group: "grandparent" },
  { value: "grandpa", label: "Grandpa", emoji: "🎣", pronoun: "he", group: "grandparent" },
  { value: "daughter", label: "Daughter", emoji: "🌟", pronoun: "she", group: "child" },
  { value: "son", label: "Son", emoji: "⭐", pronoun: "he", group: "child" },
  { value: "sister", label: "Sister", emoji: "👯", pronoun: "she", group: "sibling" },
  { value: "brother", label: "Brother", emoji: "🤜", pronoun: "he", group: "sibling" },
  { value: "best friend", label: "Best friend", emoji: "🫶", pronoun: "they", group: "friend" },
  { value: "partner", label: "Partner", emoji: "💞", pronoun: "they", group: "partner" },
  { value: "friend", label: "Friend", emoji: "🙌", pronoun: "they", group: "friend" },
  { value: "someone special", label: "Someone else", emoji: "✨", pronoun: "they", group: "other" },
];

export type Occasion = { value: string; label: string; emoji: string; gentle?: boolean };

export const OCCASIONS: Occasion[] = [
  { value: "birthday", label: "Birthday", emoji: "🎂" },
  { value: "anniversary", label: "Anniversary", emoji: "🥂" },
  { value: "valentines", label: "Valentine's", emoji: "💘" },
  { value: "mothers_day", label: "Mother's Day", emoji: "💐" },
  { value: "fathers_day", label: "Father's Day", emoji: "👔" },
  { value: "wedding", label: "Wedding", emoji: "💒" },
  { value: "proposal", label: "Proposal", emoji: "💍" },
  { value: "christmas", label: "Christmas", emoji: "🎄" },
  { value: "graduation", label: "Graduation", emoji: "🎓" },
  { value: "new_baby", label: "New baby", emoji: "🍼" },
  { value: "thank_you", label: "Thank you", emoji: "🙏" },
  { value: "apology", label: "I'm sorry", emoji: "🕊️" },
  { value: "just_because", label: "Just because", emoji: "☀️" },
  { value: "in_memory", label: "In memory", emoji: "🕯️", gentle: true },
];

export const NEEDED_BY = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "no_rush", label: "No rush" },
];

/** A story thread: one chip on the "what should it be about" screen, and the question it unlocks. */
export type Thread = {
  key: string;
  label: string;
  emoji: string;
  question: string;
  hint: string;
  starters: string[];
  /** Fallback dig-deeper question when the AI follow-up is unavailable. */
  dig: string;
};

const T: Record<string, Thread> = {
  how_met: {
    key: "how_met",
    label: "How we met",
    emoji: "✨",
    question: "How did you and {name} meet?",
    hint: "Where were you? What did you notice first?",
    starters: ["We met at…", "The first thing I noticed was…", "I knew right away because…"],
    dig: "What happened that first time that you still think about?",
  },
  moment_knew: {
    key: "moment_knew",
    label: "The moment I knew",
    emoji: "💡",
    question: "When did you know {name} was the one?",
    hint: "A small moment is perfect. Where were you, what happened?",
    starters: ["I knew when…", "It was the night we…", "{They} looked at me and…"],
    dig: "What did {they} say or do in that moment?",
  },
  laugh: {
    key: "laugh",
    label: "{Their} laugh",
    emoji: "😂",
    question: "What makes {name} laugh, and what does it sound like?",
    hint: "The thing that always cracks {them} up.",
    starters: ["{They} can't stop laughing when…", "{Their} laugh sounds like…", "Every time we…"],
    dig: "What's one time {they} laughed so hard you'll never forget it?",
  },
  sayings: {
    key: "sayings",
    label: "{Their} favourite sayings",
    emoji: "💬",
    question: "What does {name} always say?",
    hint: "A catchphrase, a nickname, a bit of advice. Their exact words sing best.",
    starters: ["{They} always says…", "{They} calls me…", "Whenever I'm down {they} tells me…"],
    dig: "When does {they} usually say it?",
  },
  hard_time: {
    key: "hard_time",
    label: "A hard time we got through",
    emoji: "🌧️",
    question: "What's a hard time {name} helped you through?",
    hint: "Only share what you're comfortable with. We'll keep it hopeful.",
    starters: ["When I was going through…", "{They} never left my side when…", "I don't think I'd have made it without {them} when…"],
    dig: "What's one thing {they} did back then that you'll never forget?",
  },
  places: {
    key: "places",
    label: "Our places",
    emoji: "📍",
    question: "Where's a place that belongs to you and {name}?",
    hint: "A town, a kitchen table, a beach, a booth at a diner.",
    starters: ["Our place is…", "Every summer we…", "We always end up at…"],
    dig: "What do you two always do when you're there?",
  },
  kids_family: {
    key: "kids_family",
    label: "Our family",
    emoji: "🏡",
    question: "What is {name} like with your family?",
    hint: "Kids, grandkids, pets, the people {they} looks after.",
    starters: ["With our kids {they}…", "Every Sunday {they}…", "{They} is the one who…"],
    dig: "What's a small family moment that shows exactly who {they} is?",
  },
  inside_joke: {
    key: "inside_joke",
    label: "An inside joke",
    emoji: "🤫",
    question: "What's an inside joke only you and {name} get?",
    hint: "Give us the word or phrase, and a line on where it came from.",
    starters: ["We always say…", "It started when…", "Nobody else gets why we…"],
    dig: "Where did that joke come from?",
  },
  gives: {
    key: "gives",
    label: "How {they} looks after everyone",
    emoji: "🤲",
    question: "What does {name} do for everyone that nobody thanks {them} for?",
    hint: "The quiet things. The rides, the meals, the calls.",
    starters: ["{They} always…", "Nobody sees how {they}…", "Without fail, {they}…"],
    dig: "What's one time that really mattered to you?",
  },
  future: {
    key: "future",
    label: "Our future",
    emoji: "🌅",
    question: "What are you and {name} dreaming about next?",
    hint: "A trip, a house, growing old on a porch.",
    starters: ["One day we're going to…", "I can't wait to…", "I picture us…"],
    dig: "When you picture it, what are you two doing?",
  },
  taught_me: {
    key: "taught_me",
    label: "What {they} taught me",
    emoji: "📖",
    question: "What did {name} teach you?",
    hint: "A skill, a lesson, the way {they} sees the world.",
    starters: ["{They} taught me how to…", "I still hear {them} saying…", "Because of {them} I…"],
    dig: "Where were you when {they} taught you that?",
  },
  childhood: {
    key: "childhood",
    label: "Growing up",
    emoji: "🧸",
    question: "What's a memory of {name} from when you were growing up?",
    hint: "A kitchen, a car ride, a holiday, a bedtime.",
    starters: ["When I was little {they}…", "Every weekend we…", "I remember {them}…"],
    dig: "What do you remember seeing, hearing, or smelling?",
  },
  traditions: {
    key: "traditions",
    label: "Our traditions",
    emoji: "🎉",
    question: "What's a tradition you and {name} share?",
    hint: "Holidays, Sunday dinners, road trips, birthday rituals.",
    starters: ["Every year we…", "On Sundays…", "It's not a holiday until…"],
    dig: "What's your favourite part of it?",
  },
  proud: {
    key: "proud",
    label: "Why I'm proud",
    emoji: "🏆",
    question: "What about {name} makes you proud?",
    hint: "Something {they} did, or who {they} became.",
    starters: ["I watched {them}…", "I'm so proud of how {they}…", "Not many people could…"],
    dig: "When did you feel that most?",
  },
  little_things: {
    key: "little_things",
    label: "The little things",
    emoji: "☕",
    question: "What little things does {name} do that you love?",
    hint: "Habits, quirks, the way {they} makes coffee.",
    starters: ["Every morning {they}…", "{They} always hums…", "I love the way {they}…"],
    dig: "Which one would you miss most?",
  },
  memory: {
    key: "memory",
    label: "A favourite memory",
    emoji: "📸",
    question: "What's your favourite memory with {name}?",
    hint: "Pick one moment and tell it like a story.",
    starters: ["The best day was when…", "I'll never forget…", "We were…"],
    dig: "What made that day so special?",
  },
};

const BY_GROUP: Record<Group, string[]> = {
  partner: ["how_met", "moment_knew", "laugh", "sayings", "hard_time", "places", "kids_family", "inside_joke", "little_things", "future"],
  parent: ["childhood", "taught_me", "sayings", "gives", "hard_time", "traditions", "laugh", "little_things", "proud", "places"],
  grandparent: ["childhood", "taught_me", "sayings", "traditions", "places", "gives", "laugh", "little_things", "memory"],
  child: ["proud", "laugh", "little_things", "memory", "traditions", "future", "sayings", "hard_time"],
  sibling: ["childhood", "inside_joke", "laugh", "hard_time", "memory", "proud", "places", "sayings"],
  friend: ["how_met", "inside_joke", "laugh", "hard_time", "memory", "places", "traditions", "sayings"],
  other: ["how_met", "memory", "laugh", "sayings", "hard_time", "gives", "little_things", "proud"],
};

export function threadsFor(group: Group): Thread[] {
  return BY_GROUP[group].map((k) => T[k]);
}

export function threadByKey(key: string): Thread | undefined {
  return T[key];
}

export type Feeling = { value: string; label: string; emoji: string; mood: string };

export const FEELINGS: Feeling[] = [
  { value: "happy_tears", label: "Cry happy tears", emoji: "😭", mood: "heartfelt" },
  { value: "laugh", label: "Laugh out loud", emoji: "😂", mood: "funny" },
  { value: "proud", label: "Feel proud", emoji: "🥹", mood: "uplifting" },
  { value: "chosen", label: "Feel loved and chosen", emoji: "❤️", mood: "romantic" },
  { value: "remember", label: "Remember the good times", emoji: "🕰️", mood: "nostalgic" },
  { value: "celebrate", label: "Want to dance", emoji: "🎉", mood: "celebratory" },
];

/** Feelings to show for a relationship and occasion. */
export function feelingsFor(group: Group, occasion: Occasion | undefined): Feeling[] {
  return FEELINGS.filter((f) => {
    if (f.value === "chosen" && group !== "partner") return false;
    if (occasion?.gentle && (f.value === "laugh" || f.value === "celebrate")) return false;
    return true;
  });
}

/** Fill {name}, {they}, {them}, {their} (and capitalised forms) in a template. */
export function fill(template: string, name: string, pronoun: Pronoun): string {
  const p = {
    she: { they: "she", them: "her", their: "her" },
    he: { they: "he", them: "him", their: "his" },
    they: { they: "they", them: "them", their: "their" },
  }[pronoun];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  let out = template
    .replaceAll("{name}", name)
    .replaceAll("{They}", cap(p.they))
    .replaceAll("{Them}", cap(p.them))
    .replaceAll("{Their}", cap(p.their))
    .replaceAll("{they}", p.they)
    .replaceAll("{them}", p.them)
    .replaceAll("{their}", p.their);
  // "they is" / "they always says" read badly; fix the common verb forms for singular they.
  if (pronoun === "they") {
    out = out
      .replace(/\b([Tt]hey) is\b/g, "$1 are")
      .replace(/\b([Tt]hey) (always |never )?(says|calls|tells|looks|hums|makes|does|sees)\b/g, (_m, t, adv = "", v: string) => `${t} ${adv}${v.replace(/s$/, "").replace(/doe$/, "do")}`);
  }
  return out;
}

/** The chapter-card example: one small detail and the lyric it could become. Illustrative, per relationship group. */
export const DETAIL_EXAMPLES: Record<Group, { from: string; to: string }> = {
  partner: { from: "She steals my hoodies", to: "You wear my hoodie like it was always yours" },
  parent: { from: "Mom made pancakes every Sunday", to: "Sunday smelled like syrup, and you were always there" },
  grandparent: { from: "Grandpa taught me to fish at the lake", to: "Down by the water, you taught me how to wait" },
  child: { from: "She sings into her hairbrush every morning", to: "Hairbrush microphone, the whole world is your stage" },
  sibling: { from: "We shared a bunk bed and talked all night", to: "Top bunk whispers till the morning came" },
  friend: { from: "We've done karaoke every Friday since college", to: "Every Friday night, same song, same mic, same us" },
  other: { from: "He always shows up with coffee", to: "Two cups of coffee and you never ask why" },
};

export const TRUST = ["About 2 minutes", "Free preview", "No card needed"];

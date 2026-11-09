/**
 * Everything that touches Suno passes through here. Suno rejects or degrades on
 * real artist names, so we strip them from user-provided style text, clamp
 * lengths to the documented limits, and run a light profanity check that the
 * verifier backs up.
 */
export const LIMITS = { style: 1000, lyrics: 5000, title: 80 } as const;

const ARTIST_BLOCKLIST = [
  "taylor swift", "ed sheeran", "adele", "beyonce", "beyoncé", "drake", "eminem", "kanye", "rihanna", "bruno mars",
  "the weeknd", "billie eilish", "olivia rodrigo", "harry styles", "coldplay", "the beatles", "elvis", "frank sinatra",
  "michael jackson", "whitney houston", "mariah carey", "celine dion", "john legend", "sam smith", "lewis capaldi",
  "luke combs", "morgan wallen", "chris stapleton", "dolly parton", "johnny cash", "garth brooks", "shania twain",
  "bad bunny", "shakira", "j balvin", "bts", "blackpink", "nirvana", "metallica", "queen", "bon jovi", "u2",
  "stevie wonder", "aretha franklin", "marvin gaye", "al green", "norah jones", "ella fitzgerald", "nat king cole",
  "jay-z", "jay z", "kendrick lamar", "travis scott", "post malone", "lizzo", "dua lipa", "lady gaga", "elton john",
];

const REFERENCE_PATTERN =
  /\b(in the style of|sounds? like|similar to|inspired by|like|a la|à la|vibes? of|cover of|by)\s+(the\s+)?([A-Z][\w'.-]*(\s+[A-Z][\w'.-]*){0,3})/g;

export type SanitizeResult = { text: string; removed: string[] };

/** Remove artist references from free text meant for Suno's style field. */
export function stripArtistReferences(input: string): SanitizeResult {
  const removed: string[] = [];
  let text = input;
  for (const name of ARTIST_BLOCKLIST) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (re.test(text)) {
      removed.push(name);
      text = text.replace(re, "");
    }
  }
  text = text.replace(REFERENCE_PATTERN, (m) => {
    removed.push(m.trim());
    return "";
  });
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
  return { text, removed };
}

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "cunt", "dick", "pussy", "nigg", "fag"];

export function findProfanity(text: string): string[] {
  const lower = text.toLowerCase();
  return PROFANITY.filter((w) => lower.includes(w));
}

export function clamp(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/** Spell out digits so Suno sings "sixty" not "6-0". */
export function spellOutSmallNumbers(text: string): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  return text.replace(/\b(\d{1,2})\b/g, (m) => {
    const n = Number(m);
    if (n <= 12) return words[n];
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    const teens = ["", "", "", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    if (n < 20) return teens[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${tens[t]}-${words[o]}` : tens[t];
  });
}

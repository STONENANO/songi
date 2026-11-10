/**
 * Text safety for anything that reaches Suno. Nothing here silently cuts
 * creative material: lyrics and style prompts are validated and rejected when
 * too long (see validate.ts and direction.ts), never truncated.
 */

/** Documented V6-family limits (docs.kie.ai/suno-api/generate-music). */
export const LIMITS = { style: 1000, lyrics: 5000, title: 80 } as const;

const ARTIST_BLOCKLIST = [
  "taylor swift", "ed sheeran", "adele", "beyonce", "beyoncé", "drake", "eminem", "kanye", "rihanna", "bruno mars",
  "the weeknd", "billie eilish", "olivia rodrigo", "harry styles", "coldplay", "the beatles", "elvis", "frank sinatra",
  "michael jackson", "whitney houston", "mariah carey", "celine dion", "john legend", "sam smith", "lewis capaldi",
  "luke combs", "morgan wallen", "chris stapleton", "dolly parton", "johnny cash", "garth brooks", "shania twain",
  "bad bunny", "shakira", "j balvin", "bts", "blackpink", "nirvana", "metallica", "queen", "bon jovi", "u2",
  "stevie wonder", "aretha franklin", "marvin gaye", "al green", "norah jones", "ella fitzgerald", "nat king cole",
  "jay-z", "jay z", "kendrick lamar", "travis scott", "post malone", "lizzo", "dua lipa", "lady gaga", "elton john",
  "ac/dc", "usher", "kacey musgraves", "zach bryan", "sza", "frank ocean",
];

const REFERENCE_PATTERN =
  /\b(in the style of|sounds? like|similar to|inspired by|like|a la|à la|vibes? of|cover of|by)\s+(the\s+)?([A-Z][\w'./-]*(\s+[A-Z][\w'./-]*){0,3})/g;

export type SanitizeResult = { text: string; removed: string[] };

/** Remove artist references from free text meant for Suno's style field. */
export function stripArtistReferences(input: string): SanitizeResult {
  const removed: string[] = [];
  let text = input;
  // Phrase + capitalised name first ("sounds like Kacey Musgraves"), so the lead-in is removed with the name.
  text = text.replace(REFERENCE_PATTERN, (m) => {
    removed.push(m.trim());
    return "";
  });
  for (const name of ARTIST_BLOCKLIST) {
    const re = new RegExp(`(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w])`, "gi");
    if (re.test(text)) {
      removed.push(name);
      text = text.replace(re, "");
    }
  }
  text = text
    .replace(/\b(like|in the style of|similar to|inspired by)\s*(?=[,.;]|$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([,;])(\s*[,;])+/g, "$1")
    .replace(/^[,.;\s]+|[,.;\s]+$/g, "")
    .trim();
  return { text, removed };
}

const PROFANITY = ["fuck", "shit", "bitch", "asshole", "cunt", "dick", "pussy", "nigg", "fag", "whore", "slut"];

export function findProfanity(text: string): string[] {
  const lower = text.toLowerCase();
  return PROFANITY.filter((w) => new RegExp(`\\b${w}`, "i").test(lower));
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

export function numberToWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
  if (n < 100) return below100(n);
  // Years are sung as two pairs: 1985 -> nineteen eighty-five, 2007 -> two thousand seven
  if (n >= 1100 && n <= 1999) {
    const hi = Math.floor(n / 100);
    const lo = n % 100;
    return lo === 0 ? `${below100(hi)} hundred` : `${below100(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : below100(lo)}`;
  }
  if (n >= 2000 && n <= 2009) return `two thousand${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  if (n >= 2010 && n <= 2099) return `twenty ${below100(n % 100)}`;
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (thousands) parts.push(`${ONES[thousands]} thousand`);
  if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
  if (rest) parts.push(`${parts.length ? "and " : ""}${below100(rest)}`);
  return parts.join(" ");
}

function ordinal(words: string): string {
  const parts = words.split(/([ -])/);
  const last = parts[parts.length - 1];
  const o = ORD[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  parts[parts.length - 1] = o;
  return parts.join("");
}

/**
 * Spell out numbers so Suno sings "sixty" not "six-oh". Handles plain numbers
 * up to 9999, sung years, and ordinals (7th -> seventh). Returns the text and
 * any numbers it could not convert.
 */
export function spellOutNumbers(text: string): { text: string; unconverted: string[] } {
  const unconverted: string[] = [];
  const out = text.replace(/\b(\d{1,4})(st|nd|rd|th)?\b/gi, (m, digits: string, suffix?: string) => {
    const w = numberToWords(Number(digits));
    if (!w) {
      unconverted.push(m);
      return m;
    }
    return suffix ? ordinal(w) : w;
  });
  for (const m of out.match(/\d+/g) ?? []) unconverted.push(m);
  return { text: out, unconverted: [...new Set(unconverted)] };
}

/** Back-compat alias used by older code paths. */
export function spellOutSmallNumbers(text: string): string {
  return spellOutNumbers(text).text;
}

/**
 * Shorten a title at a word boundary. Titles are metadata, not lyrics; the
 * change is returned so callers can record it.
 */
export function fitTitle(title: string, max: number = LIMITS.title): { title: string; changed: boolean } {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= max) return { title: t, changed: false };
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return { title: (at > 20 ? cut.slice(0, at) : t.slice(0, max)).replace(/[,;:\-–]+$/, "").trim(), changed: true };
}

/** @deprecated Kept only for non-creative metadata. Never use on lyrics or style prompts. */
export function clamp(text: string, max: number): string {
  return fitTitle(text, max).title;
}

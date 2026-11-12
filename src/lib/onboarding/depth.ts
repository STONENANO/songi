/**
 * How much real material the story has, measured the way the songwriter needs it:
 * separate concrete details, from more than one place. A story that is all one topic
 * (one saying, retold three ways) is still thin. Pure; used by the quiz before the email.
 */
import { formatFor, isAnswered, type TopicAnswer } from "./story-formats";
import { BOOSTERS } from "./content";

export type DepthInput = {
  threads: string[];
  topics: Record<string, TopicAnswer | undefined>;
  oneLine: string;
  anythingElse: string;
  boosters: Record<string, string>;
};

const words = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Details per source, capped so one long topic can't stand in for a whole story. */
export function storyDepth(i: DepthInput): { details: number; sources: number } {
  const perSource: number[] = [];
  for (const t of i.threads) {
    const fmt = formatFor(t);
    const a = i.topics[t];
    if (!isAnswered(fmt, a)) continue;
    let n = 0;
    if (fmt.kind === "tap") n = 1 + (words(a!.detail) >= 3 ? 1 : 0);
    else if (fmt.kind === "blanks") n = (a!.blanks ?? []).filter((b) => words(b) >= 1).length;
    else n = words(a!.text) >= 12 ? 2 : words(a!.text) >= 3 ? 1 : 0;
    if (n) perSource.push(Math.min(2, n));
  }
  if (words(i.oneLine) >= 3) perSource.push(1);
  if (words(i.anythingElse) >= 3) perSource.push(words(i.anythingElse) >= 15 ? 2 : 1);
  for (const v of Object.values(i.boosters)) if (words(v) >= 2) perSource.push(1);
  return { details: perSource.reduce((a, b) => a + b, 0), sources: perSource.length };
}

/** Thin: fewer than 4 details, or everything from a single place. */
export function isThin(i: DepthInput): boolean {
  const d = storyDepth(i);
  return d.details < 4 || d.sources < 2;
}

/** Up to two sentence starters for kinds of detail the buyer hasn't given yet. */
export function boostersFor(answeredThreads: string[]) {
  const fresh = BOOSTERS.filter((b) => !b.covers.some((c) => answeredThreads.includes(c)));
  return (fresh.length >= 2 ? fresh : BOOSTERS).slice(0, 2);
}

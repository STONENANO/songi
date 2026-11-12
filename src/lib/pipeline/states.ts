/**
 * The song's steps in one place: what the buyer sees at each status, whether the page
 * should keep checking for updates, and which buyer actions each status allows.
 * The song page (use-song.ts) and the API routes both read this table.
 * Pure: safe to import in the browser.
 */
import type { RequestStatus } from "../db/schema";

export type BuyerScreen = "writing" | "questions" | "review" | "recording" | "versions" | "song_page" | "failed";

export const STEPS: Record<RequestStatus, { screen: BuyerScreen; /** The server is working: keep checking. */ working: boolean }> = {
  draft: { screen: "writing", working: true },
  briefing: { screen: "writing", working: true },
  needs_input: { screen: "questions", working: false },
  writing_lyrics: { screen: "writing", working: true },
  // Story-quiz songs go straight on to recording; the page decides between "writing" and "review".
  lyrics_ready: { screen: "review", working: false },
  generating: { screen: "recording", working: true },
  processing: { screen: "recording", working: true },
  preview_ready: { screen: "versions", working: false },
  purchased: { screen: "song_page", working: false },
  failed: { screen: "failed", working: false },
};

export type BuyerAction = "answer" | "rewrite" | "record";

/**
 * from: statuses the action can start from.
 * started: statuses that mean "this action is already under way", so a repeat
 *   (double click, second tab, retry after a slow response) is answered with
 *   "already on it" instead of an error.
 */
export const ACTIONS: Record<BuyerAction, { from: RequestStatus[]; started: RequestStatus[] }> = {
  answer: { from: ["needs_input"], started: ["briefing", "writing_lyrics", "lyrics_ready", "generating", "processing", "preview_ready"] },
  rewrite: { from: ["lyrics_ready", "preview_ready", "failed"], started: ["writing_lyrics"] },
  record: { from: ["lyrics_ready", "preview_ready", "failed"], started: ["generating", "processing"] },
};

export type ActionCheck = { ok: true } | { ok: false; already: true } | { ok: false; already: false; message: string };

/** Can this action start from this status? A repeat of an action already under way is not an error. */
export function checkAction(action: BuyerAction, status: RequestStatus): ActionCheck {
  const a = ACTIONS[action];
  if (a.from.includes(status)) return { ok: true };
  if (a.started.includes(status)) return { ok: false, already: true };
  return { ok: false, already: false, message: NOT_NOW[STEPS[status].screen] };
}

/** Plain words for "you can't do that right now", by what the buyer is looking at. Never shows a status name. */
const NOT_NOW: Record<BuyerScreen, string> = {
  writing: "We're writing your song right now. This page updates on its own.",
  questions: "We need your answer to the question above first.",
  review: "Your lyrics are ready to check above.",
  recording: "We're recording your song right now. This page updates on its own.",
  versions: "Your song is ready above.",
  song_page: "This song is already yours. Refresh the page to open it.",
  failed: "Something went wrong with this song. Use “Try again” above.",
};

/** Message for a repeated action. */
export const ALREADY_ON_IT = "Already on it. One moment…";

"use client";
/** Song project state: polling and actions. No markup; song-view.tsx renders it. */
import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import type { RequestView } from "@/lib/pipeline/view";
import { STEPS } from "@/lib/pipeline/states";

/** Statuses where the server is working and the page keeps checking (from the shared table). */
const isWorking = (status: RequestView["status"]) => STEPS[status]?.working ?? false;

export type Phase = "loading" | "missing" | "denied" | "expired" | "writing" | "review" | "recording" | "versions" | "needs_input" | "failed";

/** True while a story-quiz project is between "lyrics written" and "recording started". */
function autoRecordPending(v: RequestView): boolean {
  return v.status === "lyrics_ready" && v.autoRecord && v.generationAttempts === 0 && !!v.draft?.singable;
}

export type Problem = "missing" | "denied" | "link_expired";

export function phaseOf(view: RequestView | null, problem: Problem | null): Phase {
  if (problem) return problem === "link_expired" ? "expired" : problem;
  if (!view) return "loading";
  // Unpurchased audio was deleted after the retention period.
  if (view.previewsExpired) return "expired";
  switch (view.status) {
    case "draft":
    case "briefing":
    case "writing_lyrics":
      return "writing";
    case "lyrics_ready":
      return autoRecordPending(view) ? "writing" : "review";
    case "generating":
    case "processing":
      return "recording";
    case "preview_ready":
      // Ready but nothing offered yet: still settling, keep waiting rather than showing an error.
      return view.candidates.length ? "versions" : "recording";
    case "purchased":
      return view.candidates.length ? "versions" : "failed";
    case "needs_input":
      return "needs_input";
    default:
      return "failed";
  }
}

export function useSong(id: string) {
  const [view, setView] = useState<RequestView | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracked = useRef(new Set<string>());

  const load = useCallback(async () => {
    // Pass through ?k= (claim link) and ?p= (direct preview link) so they work on a new device.
    const res = await fetch(`/api/requests/${id}${typeof window !== "undefined" ? window.location.search : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 404) return setProblem("missing");
    if (res.status === 403) {
      const j = (await res.json().catch(() => ({}))) as { code?: string };
      return setProblem(j.code === "link_expired" ? "link_expired" : "denied");
    }
    if (res.ok) setView(await res.json());
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingOrder = view?.order?.status === "pending";
  // After an action, keep checking quickly until the song leaves the status it was in,
  // even on screens that normally wait for the buyer (e.g. the questions screen).
  const [awaiting, setAwaiting] = useState<{ from: string; until: number } | null>(null);
  useEffect(() => {
    if (awaiting && view && (view.status !== awaiting.from || Date.now() > awaiting.until)) setAwaiting(null);
  }, [awaiting, view]);
  const settling = !!view && view.status === "preview_ready" && !view.candidates.length;
  const working = !!view && (isWorking(view.status) || autoRecordPending(view) || settling);
  useEffect(() => {
    if (!working && !pendingOrder && !awaiting) return;
    const t = setInterval(load, awaiting ? 1500 : pendingOrder ? 4000 : 3000);
    return () => clearInterval(t);
  }, [working, pendingOrder, awaiting, load]);

  // An error belongs to the screen it happened on: clear it when the screen changes.
  const phase = phaseOf(view, problem);
  useEffect(() => setError(null), [phase]);

  // One action at a time: a second click while the first is in flight is ignored.
  const inFlight = useRef(false);
  const post = useCallback(
    async (path: string, body: unknown, opts: { movesOn?: boolean } = {}): Promise<Record<string, unknown> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      const from = view?.status;
      const res = await fetch(`/api/requests/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const json = (res ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>;
      if (!res) setError("We couldn't reach the server. Check your connection and try again.");
      else if (!res.ok) setError((json.error as string) ?? "Something went wrong. Please try again.");
      // Started the next step (or it was already under way): check quickly until the screen moves on.
      if (res?.ok && from && opts.movesOn) setAwaiting({ from, until: Date.now() + 60_000 });
      await load();
      setBusy(false);
      inFlight.current = false;
      return res?.ok ? json : null;
    },
    [id, load, view?.status],
  );

  /** Preview play/complete analytics, once per version. */
  const trackPlay = useCallback(
    (type: "preview_play" | "preview_complete", versionId: string, position: number) => {
      const key = `${type}:${versionId}`;
      if (tracked.current.has(key)) return;
      tracked.current.add(key);
      posthog.capture(type === "preview_play" ? "preview_played" : "preview_completed", { version_position: position });
      void fetch(`/api/requests/${id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, versionId, position }) }).catch(() => {});
    },
    [id],
  );

  return {
    view,
    phase,
    problem,
    /** True from a click until the screen has moved on, so buttons stay disabled in between. */
    busy: busy || !!awaiting,
    error,
    pendingOrder,
    answerFollowUps: async (answers: Record<string, string>) => {
      const result = await post("/answers", { answers }, { movesOn: true });
      if (result) posthog.capture("follow_up_answers_submitted", { answer_count: Object.keys(answers).length });
      return result;
    },
    record: (draftId?: string) => post("/generate", draftId ? { draftId } : {}, { movesOn: true }),
    moreTakes: () => post("/generate", { more: true }, { movesOn: true }),
    select: async (versionId: string) => {
      const result = await post("/select", { versionId });
      if (result) posthog.capture("song_version_selected");
      return result;
    },
    buy: async (versionId: string) => {
      const j = await post("/checkout", { versionId });
      if (j?.checkoutUrl) {
        posthog.capture("checkout_started");
        window.location.href = j.checkoutUrl as string;
      }
    },
    /** Save edited lines, then record them (the server re-checks them first). */
    editAndRerecord: async (text: string) => {
      const saved = await post("/lyrics", { action: "edit", text });
      if (!saved) return false;
      posthog.capture("lyrics_edit_submitted");
      if (saved.status !== "verified") {
        setError("We saved your edit, but it needs a small fix before we can sing it. See the notes on the lyrics.");
        return true;
      }
      return !!(await post("/generate", {}, { movesOn: true }));
    },
    newLyrics: async () => {
      const result = await post("/lyrics", { action: "regenerate" }, { movesOn: true });
      if (result) posthog.capture("lyrics_regeneration_requested");
      return result;
    },
    sendFeedback: async (body: { rating: number; wouldPay: string | null; note: string; versionId: string | null }) => {
      const res = await fetch(`/api/requests/${id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      if (res?.ok) posthog.capture("song_feedback_submitted", { rating: body.rating, would_pay: body.wouldPay ?? "not_provided" });
      return !!res?.ok;
    },
    trackPlay,
  };
}

export type Song = ReturnType<typeof useSong>;

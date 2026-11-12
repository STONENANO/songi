"use client";
/** Song project state: polling and actions. No markup; song-view.tsx renders it. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RequestView } from "@/lib/pipeline/view";

const WORKING = new Set(["draft", "briefing", "writing_lyrics", "generating", "processing"]);

export type Phase = "loading" | "missing" | "denied" | "writing" | "review" | "recording" | "versions" | "needs_input" | "failed";

/** True while a story-quiz project is between "lyrics written" and "recording started". */
function autoRecordPending(v: RequestView): boolean {
  return v.status === "lyrics_ready" && v.autoRecord && v.generationAttempts === 0 && !!v.draft?.singable;
}

export function phaseOf(view: RequestView | null, problem: "missing" | "denied" | null): Phase {
  if (problem) return problem;
  if (!view) return "loading";
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
  const [problem, setProblem] = useState<"missing" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracked = useRef(new Set<string>());

  const load = useCallback(async () => {
    // Pass through ?k= so an emailed claim link works on a new device.
    const res = await fetch(`/api/requests/${id}${typeof window !== "undefined" ? window.location.search : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 404) return setProblem("missing");
    if (res.status === 403) return setProblem("denied");
    if (res.ok) setView(await res.json());
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingOrder = view?.order?.status === "pending";
  const working = !!view && (WORKING.has(view.status) || autoRecordPending(view));
  useEffect(() => {
    if (!working && !pendingOrder) return;
    const t = setInterval(load, pendingOrder ? 4000 : 3000);
    return () => clearInterval(t);
  }, [working, pendingOrder, load]);

  const post = useCallback(
    async (path: string, body: unknown): Promise<Record<string, unknown> | null> => {
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/requests/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const json = (res ? await res.json().catch(() => ({})) : {}) as Record<string, unknown>;
      if (!res?.ok) setError((json.error as string) ?? "Something went wrong. Please try again.");
      setBusy(false);
      await load();
      return res?.ok ? json : null;
    },
    [id, load],
  );

  /** Preview play/complete analytics, once per version. */
  const trackPlay = useCallback(
    (type: "preview_play" | "preview_complete", versionId: string, position: number) => {
      const key = `${type}:${versionId}`;
      if (tracked.current.has(key)) return;
      tracked.current.add(key);
      void fetch(`/api/requests/${id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, versionId, position }) }).catch(() => {});
    },
    [id],
  );

  return {
    view,
    phase: phaseOf(view, problem),
    busy,
    error,
    pendingOrder,
    answerFollowUps: (answers: Record<string, string>) => post("/answers", { answers }),
    record: (draftId?: string) => post("/generate", draftId ? { draftId } : {}),
    moreTakes: () => post("/generate", { more: true }),
    select: (versionId: string) => post("/select", { versionId }),
    buy: async (versionId: string) => {
      const j = await post("/checkout", { versionId });
      if (j?.checkoutUrl) window.location.href = j.checkoutUrl as string;
    },
    /** Save edited lines, then record them (the server re-checks them first). */
    editAndRerecord: async (text: string) => {
      const saved = await post("/lyrics", { action: "edit", text });
      if (!saved) return false;
      if (saved.status !== "verified") {
        setError("We saved your edit, but it needs a small fix before we can sing it. See the notes on the lyrics.");
        return true;
      }
      return !!(await post("/generate", {}));
    },
    newLyrics: () => post("/lyrics", { action: "regenerate" }),
    sendFeedback: async (body: { rating: number; wouldPay: string | null; note: string; versionId: string | null }) => {
      const res = await fetch(`/api/requests/${id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      return !!res?.ok;
    },
    trackPlay,
  };
}

export type Song = ReturnType<typeof useSong>;

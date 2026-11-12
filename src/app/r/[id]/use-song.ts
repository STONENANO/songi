"use client";
/** Song request state: polling and actions. No markup; song-view.tsx renders it. */
import { useCallback, useEffect, useState } from "react";
import type { RequestView } from "@/lib/pipeline/run";

const WORKING = new Set(["draft", "briefing", "writing_lyrics", "generating", "processing"]);

export type Phase = "loading" | "missing" | "writing" | "review" | "recording" | "preview" | "needs_input" | "failed";

export function phaseOf(view: RequestView | null, missing: boolean): Phase {
  if (missing) return "missing";
  if (!view) return "loading";
  switch (view.status) {
    case "draft":
    case "briefing":
    case "writing_lyrics":
      return "writing";
    case "lyrics_ready":
      // New funnel records straight away; this state only lasts a moment.
      return view.autoGenerate && view.generationAttempts === 0 ? "writing" : "review";
    case "generating":
    case "processing":
      return "recording";
    case "preview_ready":
      return "preview";
    case "needs_input":
      return "needs_input";
    default:
      return "failed";
  }
}

export function useSong(id: string) {
  const [view, setView] = useState<RequestView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/requests/${id}`, { cache: "no-store" }).catch(() => null);
    if (!res) return;
    if (res.status === 404) {
      setMissing(true);
      return;
    }
    if (res.ok) setView(await res.json());
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const working = !!view && (WORKING.has(view.status) || (view.status === "lyrics_ready" && view.autoGenerate && view.generationAttempts === 0));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [working, load]);

  const post = useCallback(
    async (path: string, body: unknown): Promise<boolean> => {
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/requests/${id}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const json = res ? await res.json().catch(() => ({})) : {};
      const ok = !!res?.ok;
      if (!ok) setError((json as { error?: string }).error ?? "Something went wrong. Please try again.");
      setBusy(false);
      await load();
      return ok;
    },
    [id, load],
  );

  return {
    view,
    phase: phaseOf(view, missing),
    busy,
    error,
    answerFollowUps: (answers: Record<string, string>) => post("/answers", { answers }),
    record: (draftId?: string) => post("/generate", draftId ? { draftId } : {}),
    /** Save edited lines, then re-record with them. */
    editAndRerecord: async (text: string) => {
      const ok = await post("/lyrics", { action: "edit", text });
      if (ok) await post("/generate", {});
      return ok;
    },
    newLyrics: () => post("/lyrics", { action: "regenerate" }),
    unlock: (code: string) => post("/unlock", { code }),
  };
}

export type Song = ReturnType<typeof useSong>;

"use client";
/**
 * Story quiz state and behaviour. No markup here: screens.tsx renders it.
 * Answers persist to sessionStorage so a refresh never loses a story.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FEELINGS, OCCASIONS, RELATIONSHIPS, fill, threadByKey, type Pronoun, type Group } from "@/lib/onboarding/content";

export type ThreadAnswer = { answer: string; followUp: string; followUpAnswer: string; probed: boolean };

export type QuizState = {
  relationship: string;
  recipientName: string;
  pronunciation: string;
  occasion: string;
  neededBy: string;
  threads: string[];
  answers: Record<string, ThreadAnswer>;
  ingredients: string[];
  oneLine: string;
  feeling: string;
  leaveOut: string;
  genreKey: string;
  vocalGender: "m" | "f" | "any";
  email: string;
  phone: string;
  giverName: string;
  stepId: string;
};

const EMPTY: QuizState = {
  relationship: "",
  recipientName: "",
  pronunciation: "",
  occasion: "",
  neededBy: "",
  threads: [],
  answers: {},
  ingredients: [],
  oneLine: "",
  feeling: "",
  leaveOut: "",
  genreKey: "",
  vocalGender: "any",
  email: "",
  phone: "",
  giverName: "",
  stepId: "who",
};

export const MAX_THREADS = 3;
export const MIN_THREADS = 2;
export const MAX_PROBES = 3;
export const MIN_ANSWER_CHARS = 15;
const STORAGE_KEY = "story-quiz-v1";

export const CHAPTERS = ["Who it's for", "Their story", "The sound"] as const;

export type StepId = string; // "who" | "name" | "occasion" | "story_intro" | "threads" | `q:${thread}` | "one_line" | "feeling" | "sound" | "send"

function stepsFor(threads: string[]): StepId[] {
  return ["who", "name", "occasion", "story_intro", "threads", ...threads.map((t) => `q:${t}`), "one_line", "feeling", "sound", "send"];
}

function chapterOf(step: StepId): number {
  if (step === "who" || step === "name" || step === "occasion") return 0;
  if (step === "sound" || step === "send") return 2;
  return 1;
}

function sessionId(): string {
  try {
    let id = sessionStorage.getItem("quiz-session");
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("quiz-session", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export function track(type: string, payload: Record<string, string | number | boolean> = {}, requestId?: string) {
  try {
    const body = JSON.stringify({ type, sessionId: sessionId(), requestId, payload });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    else void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  } catch {
    /* analytics must never break the quiz */
  }
}

export function useQuiz() {
  const router = useRouter();
  const [s, setS] = useState<QuizState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore an in-progress quiz after a refresh.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setS({ ...EMPTY, ...(JSON.parse(raw) as Partial<QuizState>) });
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s, loaded]);

  const rel = RELATIONSHIPS.find((r) => r.value === s.relationship);
  const pronoun: Pronoun = rel?.pronoun ?? "they";
  const group: Group = rel?.group ?? "other";
  const occasion = OCCASIONS.find((o) => o.value === s.occasion);
  const name = s.recipientName.trim() || "them";
  const f = useCallback((template: string) => fill(template, name, pronoun), [name, pronoun]);

  const steps = useMemo(() => stepsFor(s.threads), [s.threads]);
  const index = Math.max(0, steps.indexOf(s.stepId));
  const step = steps[index] ?? "who";

  const chapter = chapterOf(step);
  const chapters = CHAPTERS.map((label, c) => {
    const inChapter = steps.filter((st) => chapterOf(st) === c);
    const pos = inChapter.indexOf(step);
    const progress = c < chapter ? 1 : c > chapter ? 0 : (pos + 0.5) / inChapter.length;
    return { label, progress };
  });

  // Track each step view once per visit.
  const lastTracked = useRef<string>("");
  useEffect(() => {
    if (!loaded || lastTracked.current === step) return;
    lastTracked.current = step;
    track("quiz:step_view", { step: step.startsWith("q:") ? "question" : step, thread: step.startsWith("q:") ? step.slice(2) : "", index });
  }, [step, index, loaded]);

  const set = useCallback(<K extends keyof QuizState>(k: K, v: QuizState[K]) => setS((p) => ({ ...p, [k]: v })), []);

  const goTo = useCallback((id: StepId) => {
    setS((p) => ({ ...p, stepId: id }));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const next = useCallback(() => {
    const n = steps[index + 1];
    if (n) goTo(n);
  }, [steps, index, goTo]);
  const back = useCallback(() => {
    const p = steps[index - 1];
    if (p) goTo(p);
  }, [steps, index, goTo]);

  /*
   * Phone back button / swipe-back. The quiz lives on one URL, so without this
   * "back" would leave the quiz. While past the first screen we keep one guard
   * history entry; the browser's back pops it and we step back a question
   * instead (and re-arm the guard). On the first screen back leaves as normal.
   * Works after a refresh mid-quiz too, unlike one history entry per step.
   */
  const guardArmed = useRef(false);
  const navRef = useRef({ index, steps });
  navRef.current = { index, steps };
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    if (index > 0 && !guardArmed.current) {
      window.history.pushState({ quizGuard: true }, "");
      guardArmed.current = true;
    }
  }, [index, loaded]);
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const onPop = () => {
      if (!guardArmed.current) return; // nothing of ours to undo: let the browser leave
      guardArmed.current = false;
      const { index: i, steps: st } = navRef.current;
      const prev = st[i - 1];
      if (!prev) return;
      track("quiz:browser_back", { from: st[i] ?? "" });
      setS((p) => ({ ...p, stepId: prev }));
      window.scrollTo({ top: 0 });
      // Still mid-quiz: re-arm so the next back also steps back a question.
      if (i - 1 > 0) {
        window.history.pushState({ quizGuard: true }, "");
        guardArmed.current = true;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loaded]);

  const toggleThread = useCallback((key: string) => {
    setS((p) => {
      const on = p.threads.includes(key);
      if (!on && p.threads.length >= MAX_THREADS) return p;
      return { ...p, threads: on ? p.threads.filter((t) => t !== key) : [...p.threads, key] };
    });
  }, []);

  const setAnswer = useCallback((thread: string, patch: Partial<ThreadAnswer>) => {
    setS((p) => {
      const prev = p.answers[thread] ?? { answer: "", followUp: "", followUpAnswer: "", probed: false };
      return { ...p, answers: { ...p.answers, [thread]: { ...prev, ...patch } } };
    });
  }, []);

  const addIngredients = useCallback((items: string[]) => {
    setS((p) => {
      const seen = new Set(p.ingredients.map((i) => i.toLowerCase()));
      const add = items.map((i) => i.trim()).filter((i) => i && !seen.has(i.toLowerCase()));
      return add.length ? { ...p, ingredients: [...p.ingredients, ...add].slice(-12) } : p;
    });
  }, []);

  const answered = s.threads.filter((t) => (s.answers[t]?.answer ?? "").trim().length >= MIN_ANSWER_CHARS);
  const probesUsed = Object.values(s.answers).filter((a) => a.followUp).length;
  /** 0..5: how much real material we have. Drives the strength meter. */
  const strength = Math.min(
    5,
    answered.length + Math.floor(s.ingredients.length / 3) + (s.oneLine.trim().length > 10 ? 1 : 0) + (Object.values(s.answers).some((a) => a.followUpAnswer.trim()) ? 1 : 0),
  );

  /** Ask for a dig-deeper follow-up. Resolves to null on timeout or error; the quiz never waits long. */
  const probe = useCallback(
    async (thread: string, question: string, answer: string, isFollowUp: boolean, timeoutMs: number) => {
      const t = threadByKey(thread);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch("/api/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            recipientName: s.recipientName,
            relationship: s.relationship,
            pronoun,
            question,
            answer,
            isFollowUp,
            fallbackDig: t ? f(t.dig) : "",
          }),
        });
        if (!res.ok) return null;
        return (await res.json()) as { reaction: string; followUp: string; ingredients: string[] };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    [s.recipientName, s.relationship, pronoun, f],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const feeling = FEELINGS.find((x) => x.value === s.feeling);
    const answers = s.threads
      .map((key) => {
        const t = threadByKey(key);
        const a = s.answers[key];
        if (!t || !a?.answer.trim()) return null;
        return {
          thread: key,
          question: f(t.question),
          answer: a.answer,
          followUp: a.followUp,
          followUpAnswer: a.followUpAnswer,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientName: s.recipientName,
        pronunciation: s.pronunciation,
        relationship: s.relationship,
        occasion: s.occasion,
        neededBy: s.neededBy,
        answers,
        oneLine: s.oneLine,
        feeling: s.feeling,
        leaveOut: s.leaveOut,
        genreKey: s.genreKey,
        vocalGender: s.vocalGender,
        mood: feeling?.mood ?? "",
        email: s.email,
        phone: s.phone,
        giverName: s.giverName,
      }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setError((json as { error?: string }).error ?? "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    const id = (json as { id: string }).id;
    track("quiz:submitted", { threads: s.threads.length, answered: answered.length, ingredients: s.ingredients.length, strength }, id);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    router.push(`/r/${id}`);
  }, [s, f, answered.length, strength, router]);

  return {
    s,
    loaded,
    set,
    step,
    index,
    steps,
    chapter,
    chapters,
    next,
    back: index > 0 ? back : undefined,
    goTo,
    toggleThread,
    setAnswer,
    addIngredients,
    probe,
    probesUsed,
    answered,
    strength,
    rel,
    group,
    pronoun,
    occasion,
    name,
    f,
    submit,
    busy,
    error,
  };
}

export type Quiz = ReturnType<typeof useQuiz>;

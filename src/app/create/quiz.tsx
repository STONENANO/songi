"use client";

import { Screen } from "@/components/ui";
import { useQuiz, type Quiz } from "./use-quiz";
import {
  FeelingScreen,
  OccasionScreen,
  LastTouchesScreen,
  ReadBackScreen,
  TopicScreen,
  SendScreen,
  SoundScreen,
  ThreadsScreen,
  WhoScreen,
  type Genre,
  type ScreenParts,
} from "./screens";

export default function StoryQuiz({ genres }: { genres: Genre[] }) {
  const q = useQuiz();
  if (!q.loaded) return null; // avoid flashing step 1 before a saved quiz is restored
  // Keyed by step so every step mounts fresh: screens can hold their own state and hooks.
  return <Step key={q.step} q={q} genres={genres} />;
}

function Step({ q, genres }: { q: Quiz; genres: Genre[] }) {
  const parts = render(q, genres);
  return (
    <Screen onBack={q.back} chapters={q.chapters} activeChapter={q.chapter} footer={parts.footer}>
      {parts.body}
    </Screen>
  );
}

function render(q: Quiz, genres: Genre[]): ScreenParts {
  const step = q.step;
  if (step.startsWith("q:")) return TopicScreen(q, step.slice(2));
  switch (step) {
    case "who":
      return WhoScreen(q);
    case "occasion":
      return OccasionScreen(q);
    case "threads":
      return ThreadsScreen(q);
    case "last_touches":
      return LastTouchesScreen(q);
    case "readback":
      return ReadBackScreen(q);
    case "feeling":
      return FeelingScreen(q);
    case "sound":
      return SoundScreen(q, genres);
    case "send":
      return SendScreen(q, genres);
    default:
      return WhoScreen(q);
  }
}

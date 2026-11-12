"use client";
/**
 * The song page: writing → recording (the wait, our sales window) → preview.
 * Layout only; behaviour is in use-song.ts. Visuals come from components/ui.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AudioPlayer,
  Banner,
  Button,
  Card,
  Chip,
  Chips,
  Checklist,
  ErrorText,
  Field,
  Lyrics,
  Note,
  ProgressBar,
  Screen,
  ScreenTitle,
  Stages,
  StudioCard,
  TextArea,
  TextInput,
  TrustRow,
  WaitVideo,
  type StageState,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { buildLyricSections, chorusOf, storyLineCount } from "@/lib/onboarding/lyrics-view";
import { useSong, type Song } from "./use-song";
import type { RequestView } from "@/lib/pipeline/run";

function names(view: RequestView) {
  const name = view.recipientName || view.brief?.recipient.name || "them";
  const rel = view.relationship.replace(/_/g, " ");
  const giver = view.giverName || view.brief?.giverName || "";
  return { name, rel, giver };
}

/** Seconds since `since`, ticking every second. */
function useElapsed(since: string | Date | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return 0;
  return Math.max(0, (now - new Date(since).getTime()) / 1000);
}

export default function SongView({ id }: { id: string }) {
  const song = useSong(id);
  const { view, phase } = song;

  if (phase === "missing") {
    return (
      <Screen>
        <ScreenTitle title="We couldn't find this song." subtitle="Check the link in your email, or start a new one." />
        <Button href="/create">Start a song</Button>
      </Screen>
    );
  }
  if (!view) {
    return (
      <Screen>
        <Note>Loading…</Note>
      </Screen>
    );
  }

  return (
    <Screen animKey={phase}>
      {(view.mock.llm || view.mock.kie) && (
        <Banner>
          Mock mode: {[view.mock.llm && "lyrics are placeholder text", view.mock.kie && "audio is a test tone"].filter(Boolean).join(" and ")}. Add API keys in .env for real songs.
        </Banner>
      )}
      {phase === "writing" && <Writing view={view} />}
      {phase === "recording" && <Recording view={view} />}
      {phase === "preview" && <Preview view={view} song={song} />}
      {phase === "review" && <Review view={view} song={song} />}
      {phase === "needs_input" && <NeedsInput view={view} song={song} />}
      {phase === "failed" && <Failed view={view} song={song} />}
      {song.error && <ErrorText>{song.error}</ErrorText>}
    </Screen>
  );
}

/* --------------------------------- writing --------------------------------- */

function Writing({ view }: { view: RequestView }) {
  const { name } = names(view);
  const t = useElapsed(view.createdAt);
  const s = view.status;
  const briefDone = s !== "draft" && s !== "briefing";
  const lyricsDone = view.drafts.length > 0;
  const state = (done: boolean, active: boolean): StageState => (done ? "done" : active ? "active" : "todo");
  const stages = [
    { label: "Reading your story", state: state(briefDone || t > 6, true) },
    { label: "Picking the details worth singing", state: state(briefDone, t > 6 || briefDone) },
    { label: `Writing the chorus around “${name}”`, state: state(lyricsDone || (briefDone && t > 22), briefDone) },
    { label: "Checking every line against your story", state: state(lyricsDone, briefDone && t > 22) },
  ];
  const facts = view.brief?.facts ?? [];
  return (
    <>
      <ScreenTitle eyebrow="Step 1 of 2" title={`Writing ${name}'s song`} subtitle="This takes about 30 seconds. Then we record it." />
      <Card>
        <Stages items={stages} />
      </Card>
      {facts.length > 0 && (
        <Card tone="muted" title="What we're singing about">
          <Chips>
            {facts.slice(0, 8).map((f, i) => (
              <span key={i} className="ui-tray__item">{f.text}</span>
            ))}
          </Chips>
        </Card>
      )}
    </>
  );
}

/* -------------------------------- recording -------------------------------- */

function recordProgress(view: RequestView, elapsed: number): { value: number; label: string } {
  const { name } = names(view);
  if (view.status === "processing") return { value: 0.9 + 0.09 * Math.min(1, elapsed / 30), label: "Cutting your preview" };
  const v = Math.min(0.9, elapsed / BRAND.estRecordSeconds);
  const label = v < 0.2 ? "Laying down the music" : v < 0.5 ? "Recording vocals" : v < 0.75 ? `Singing ${name}'s name in the chorus` : "Mixing and mastering";
  return { value: v, label };
}

function Recording({ view }: { view: RequestView }) {
  const { name } = names(view);
  const elapsed = useElapsed(view.statusSince);
  const progress = recordProgress(view, elapsed);
  const draft = view.drafts[0];
  const sections = useMemo(() => (draft ? buildLyricSections(draft.displayLyrics, draft.report) : []), [draft]);
  const fromStory = storyLineCount(sections);
  const messages = useMemo(() => {
    const facts = (view.brief?.facts ?? []).filter((f) => f.priority <= 2).map((f) => f.text);
    return [
      `Recording ${name}'s song`,
      ...facts.slice(0, 3).map((f) => `Singing about “${f.length > 60 ? f.slice(0, 57) + "…" : f}”`),
      `Putting ${name}'s name in the chorus`,
      `Laying down the ${view.genreLabel.toLowerCase()} groove`,
    ];
  }, [view.brief, view.genreLabel, name]);

  return (
    <>
      <ScreenTitle eyebrow="Step 2 of 2 · Recording now" title={`${name}'s song is being recorded`} />
      {BRAND.waitVideoUrl ? <WaitVideo src={BRAND.waitVideoUrl} /> : <StudioCard messages={messages} sub={`${view.genreLabel} · written for ${name}`} />}
      <div className="ui-mt ui-stack">
        <ProgressBar value={progress.value} label={progress.label} />
        <p className="ui-pointer">👇 Your free preview will appear right here</p>
      </div>
      {draft && (
        <Card title={`While you wait, here's what we wrote for ${name}`}>
          <Lyrics
            sections={sections}
            reveal
            legend={fromStory > 0 ? `${fromStory} line${fromStory === 1 ? "" : "s"} came straight from your story. Tap one to see.` : undefined}
          />
          <Note>Want to change a line? You can, free, after you hear it.</Note>
        </Card>
      )}
      <WhatYouGet name={name} />
    </>
  );
}

function WhatYouGet({ name }: { name: string }) {
  return (
    <Card tone="muted" title="What happens next">
      <Checklist
        items={[
          "Your free preview plays right here in a few minutes",
          "Two different takes, so you can pick the one you love",
          "Change any line for free and we'll re-record it",
          `Unlock the full song when you're ready to give it to ${name}`,
        ]}
      />
    </Card>
  );
}

/* --------------------------------- preview --------------------------------- */

function Preview({ view, song }: { view: RequestView; song: Song }) {
  const { name, rel, giver } = names(view);
  const ready = view.versions.filter((v) => v.status === "ready").slice(0, 2);
  const draft = view.drafts[0];
  const sections = useMemo(() => (draft ? buildLyricSections(draft.displayLyrics, draft.report) : []), [draft]);
  const chorus = chorusOf(sections);
  const [allLyrics, setAllLyrics] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const outOfTakes = view.generationAttempts >= view.maxGenerationAttempts * 3;

  return (
    <>
      <ScreenTitle
        eyebrow="Your free preview"
        title={`${name}'s Song`}
        subtitle={`An original ${view.genreLabel} song written for ${name}, your ${rel}${giver ? `, from ${giver}` : ""}. Headphones in if you have them.`}
      />
      <div className="ui-stack">
        {ready.map((v, i) =>
          view.unlocked && v.fullUrl ? (
            <div key={v.id} className="ui-stack">
              <AudioPlayer src={v.fullUrl} title={`${v.title} · Take ${String.fromCharCode(65 + i)} · full song`} seed={i + 1} />
              <Button variant="text" href={v.fullUrl} download>
                Download take {String.fromCharCode(65 + i)}
              </Button>
            </div>
          ) : (
            v.previewUrl && <AudioPlayer key={v.id} src={v.previewUrl} title={`Take ${String.fromCharCode(65 + i)} · preview`} seed={i + 1} />
          ),
        )}
      </div>

      {!view.unlocked && (
        <div className="ui-mt ui-stack">
          <Button block onClick={() => setUnlockOpen((o) => !o)}>
            🔒 Unlock {name}&apos;s full song
          </Button>
          <TrustRow items={["Change any line free", "Two takes included"]} />
        </div>
      )}
      {unlockOpen && !view.unlocked && <UnlockPanel name={name} song={song} />}

      {chorus && (
        <Card title={allLyrics ? "The lyrics" : "The chorus"}>
          <Lyrics sections={allLyrics ? sections : [chorus]} legend="Highlighted lines came from your story. Tap one to see." />
          <Button variant="text" onClick={() => setAllLyrics((a) => !a)}>
            {allLyrics ? "Show just the chorus" : "See all the lyrics"}
          </Button>
        </Card>
      )}

      {draft && (
        <Card tone="muted" title="Want to change something?">
          {!editing ? (
            <>
              <Note>Wrong word, wrong name, or a line that isn&apos;t quite right? Edit it and we&apos;ll re-record, free.</Note>
              <div className="ui-mt">
                <Button variant="secondary" disabled={outOfTakes} onClick={() => setEditing(true)}>
                  Change a line
                </Button>
              </div>
            </>
          ) : (
            <EditLyrics initial={draft.displayLyrics} song={song} onDone={() => setEditing(false)} />
          )}
        </Card>
      )}
    </>
  );
}

function UnlockPanel({ name, song }: { name: string; song: Song }) {
  const [code, setCode] = useState("");
  return (
    <Card title={`${name}'s full song`}>
      <Checklist items={["The full song, every verse", "Both takes as MP3 downloads", "Free line changes and re-records"]} />
      <div className="ui-mt">
        <Note>Checkout is opening soon.</Note>
      </div>
      <hr className="ui-divider" />
      <Field label="Have a creator code?">
        <TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" autoCapitalize="characters" />
      </Field>
      <Button variant="secondary" disabled={!code.trim() || song.busy} onClick={() => void song.unlock(code)}>
        Unlock with code
      </Button>
    </Card>
  );
}

function EditLyrics({ initial, song, onDone }: { initial: string; song: Song; onDone: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <TextArea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 360, fontFamily: "var(--font-lyrics)" }} aria-label="Lyrics" />
      <Note>Keep the section labels like [Chorus]. We check every edit before we sing it.</Note>
      <div className="ui-row ui-mt">
        <Button
          disabled={song.busy || text.trim() === initial.trim()}
          onClick={async () => {
            if (await song.editAndRerecord(text)) onDone();
          }}
        >
          {song.busy ? "Saving…" : "Save and re-record"}
        </Button>
        <Button variant="text" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/* --------------------------- review (legacy flow) --------------------------- */

function Review({ view, song }: { view: RequestView; song: Song }) {
  const { name } = names(view);
  const draft = view.drafts[0];
  const sections = useMemo(() => (draft ? buildLyricSections(draft.displayLyrics, draft.report) : []), [draft]);
  const [editing, setEditing] = useState(false);
  if (!draft) return null;
  return (
    <>
      <ScreenTitle title={`${name}'s lyrics are ready`} subtitle="Read them through, then we'll record." />
      <Card title={draft.title}>
        {editing ? (
          <EditLyrics initial={draft.displayLyrics} song={song} onDone={() => setEditing(false)} />
        ) : (
          <Lyrics sections={sections} legend="Highlighted lines came from your story." />
        )}
      </Card>
      {!editing && (
        <div className="ui-row">
          <Button disabled={song.busy} onClick={() => void song.record(draft.id)}>
            Record it
          </Button>
          <Button variant="secondary" disabled={song.busy} onClick={() => setEditing(true)}>
            Change a line
          </Button>
          <Button variant="text" disabled={song.busy} onClick={() => void song.newLyrics()}>
            Write new lyrics
          </Button>
        </div>
      )}
    </>
  );
}

/* ------------------------------ needs input ------------------------------ */

function NeedsInput({ view, song }: { view: RequestView; song: Song }) {
  const { name } = names(view);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const qs = view.followUpQuestions;
  return (
    <>
      <ScreenTitle title={`One more thing about ${name}`} subtitle="A small detail will make the song unmistakably about them." />
      {qs.map((q) => (
        <Field key={q} label={q}>
          <TextArea style={{ minHeight: 100 }} value={answers[q] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))} />
        </Field>
      ))}
      <div className="ui-row">
        <Button disabled={song.busy || qs.some((q) => !(answers[q] ?? "").trim())} onClick={() => void song.answerFollowUps(answers)}>
          Continue
        </Button>
        <Button variant="text" disabled={song.busy} onClick={() => void song.answerFollowUps(Object.fromEntries(qs.map((q) => [q, "(skipped)"])))}>
          Skip
        </Button>
      </div>
    </>
  );
}

/* --------------------------------- failed --------------------------------- */

function Failed({ view, song }: { view: RequestView; song: Song }) {
  const { name } = names(view);
  return (
    <>
      <ScreenTitle title={`We hit a snag with ${name}'s song`} subtitle="It happens now and then. Trying again usually works." />
      <Card>
        <Button disabled={song.busy || !view.drafts.length} onClick={() => void song.record()}>
          Try recording again
        </Button>
        {view.lastError && (
          <div className="ui-mt">
            <Note>Details: {view.lastError}</Note>
          </div>
        )}
      </Card>
      <Chips>
        <Chip onClick={() => (window.location.href = "/create")}>Start a new song</Chip>
      </Chips>
    </>
  );
}

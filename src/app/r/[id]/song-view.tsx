"use client";
/**
 * The song page: writing → recording (the wait, our sales window) → versions
 * (pick one, buy, download, feedback). Layout only; behaviour is in use-song.ts.
 * Visuals come from components/ui and app/theme.css.
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
  MascotStage,
  Note,
  ProgressBar,
  Screen,
  ScreenTitle,
  Stages,
  TextArea,
  TrustRow,
  WaitVideo,
  type MascotClip,
  type StageState,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { buildLyricSections, chorusOf, storyLineCount } from "@/lib/onboarding/lyrics-view";
import { useSong, type Song } from "./use-song";
import type { RequestView } from "@/lib/pipeline/view";

function names(view: RequestView) {
  const name = view.recipientName || view.brief?.recipient.name || "them";
  const rel = view.relationship.replace(/_/g, " ");
  return { name, rel, giver: view.giverName };
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

function useSections(view: RequestView) {
  const draft = view.draft;
  return useMemo(() => (draft ? buildLyricSections(draft.displayLyrics, draft.storyLines ?? []) : []), [draft]);
}

export default function SongView({ id }: { id: string }) {
  const song = useSong(id);
  const { view, phase } = song;
  // Once a song is bought, its home is the player page; this page is only for choosing and buying.
  const songPage = view?.order?.status === "paid" ? view.order.deliveryLink : null;
  useEffect(() => {
    if (songPage) window.location.replace(songPage);
  }, [songPage]);

  if (phase === "expired") {
    const linkOnly = song.problem === "link_expired";
    return (
      <Screen>
        <ScreenTitle
          title={linkOnly ? "This preview link has expired." : "These previews have expired."}
          subtitle={
            linkOnly
              ? "Preview links work for a limited time. If you made this song in this browser, open it from there, or start a new one."
              : "Versions that weren't bought are only kept for a while. You can start a new song any time."
          }
        />
        <Button href="/create">Start a song</Button>
      </Screen>
    );
  }
  if (phase === "missing" || phase === "denied") {
    return (
      <Screen>
        <ScreenTitle
          title={phase === "denied" ? "This song was made on another device." : "We couldn't find this song."}
          subtitle={phase === "denied" ? "Open it from the browser you created it in, or use the link from your email." : "Check the link in your email, or start a new one."}
        />
        <Button href="/create">Start a song</Button>
      </Screen>
    );
  }
  if (!view || songPage) {
    return (
      <Screen>
        <Note>Loading…</Note>
      </Screen>
    );
  }

  return (
    <Screen animKey={phase}>
      {view.mock.banner && (view.mock.llm || view.mock.kie || view.mock.payments) && (
        <Banner>
          Test mode: {[view.mock.llm && "placeholder lyrics", view.mock.kie && "test-tone audio", view.mock.payments && "test checkout"].filter(Boolean).join(", ")}. Add API keys in .env for real songs and payments.
        </Banner>
      )}
      {phase === "writing" && <Writing view={view} />}
      {phase === "recording" && <Recording view={view} />}
      {phase === "versions" && <Versions view={view} song={song} />}
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
  const lyricsDone = !!view.draft;
  const state = (done: boolean, active: boolean): StageState => (done ? "done" : active ? "active" : "todo");
  const stages = [
    { label: "Reading your story", state: state(briefDone || t > 6, true) },
    { label: "Picking the details worth singing", state: state(briefDone, t > 6 || briefDone) },
    { label: `Writing the chorus around “${name}”`, state: state(lyricsDone || (briefDone && t > 40), briefDone) },
    { label: "Checking every line against your story", state: state(lyricsDone, briefDone && t > 40) },
  ];
  const facts = view.brief?.facts ?? [];
  const now = stages.find((x) => x.state === "active") ?? stages[stages.length - 1];
  return (
    <>
      <ScreenTitle eyebrow="Step 1 of 2" title={`Writing ${name}'s song`} subtitle="This takes about a minute. Then we record it." />
      <div className="ui-mb">
        <MascotStage clip="writing" label={now.label} />
      </div>
      <Card>
        <Stages items={stages} />
      </Card>
      {facts.length > 0 && (
        <Card tone="muted" title="What we're singing about">
          <Chips>
            {facts.slice(0, 8).map((f) => (
              <span key={f.id} className="ui-tray__item">{f.text}</span>
            ))}
          </Chips>
        </Card>
      )}
    </>
  );
}

/* -------------------------------- recording -------------------------------- */

/** Where the recording is, as a progress value, a status line, and the mascot clip that acts it out. */
function recordProgress(view: RequestView, elapsed: number): { value: number; label: string; clip: MascotClip } {
  const { name } = names(view);
  const g = view.generation;
  const readyShare = g.desired ? Math.min(1, g.usable / g.desired) : 0;
  if (view.status === "processing") return { value: Math.max(0.9, 0.9 + 0.09 * readyShare), label: "Checking each recording", clip: "checking" };
  const v = Math.max(Math.min(0.9, elapsed / BRAND.estRecordSeconds), 0.9 * readyShare);
  if (v < 0.2) return { value: v, label: "Laying down the music", clip: "music" };
  if (v < 0.5) return { value: v, label: "Recording vocals", clip: "vocals" };
  if (v < 0.75) return { value: v, label: `Singing ${name}'s name in the chorus`, clip: "name" };
  return { value: v, label: "Mixing and mastering", clip: "mixing" };
}

function Recording({ view }: { view: RequestView }) {
  const { name } = names(view);
  const elapsed = useElapsed(view.statusSince);
  const progress = recordProgress(view, elapsed);
  return (
    <>
      <ScreenTitle eyebrow="Step 2 of 2 · Recording now" title={`${name}'s song is being recorded`} />
      {BRAND.waitVideoUrl ? <WaitVideo src={BRAND.waitVideoUrl} /> : <MascotStage clip={progress.clip} label={progress.label} rec />}
      <div className="ui-mt ui-stack">
        <ProgressBar value={progress.value} label={progress.label} />
        <p className="ui-pointer">👇 Your free preview will appear right here</p>
      </div>
      {view.draft && <LockedLyrics view={view} title={`${name}'s lyrics are a surprise`} />}
      <Card tone="muted" title="What happens next">
        <Checklist
          items={[
            `We're recording ${view.generation.desired > 1 ? `${view.generation.desired} versions in different styles` : "your song"}, and checking each one before you hear it`,
            "Your free previews play right here in a few minutes",
            "The full lyrics come with the song",
            `Pick your favourite and get the full song for ${name}`,
          ]}
        />
      </Card>
    </>
  );
}

/* ------------------------------ preview link ------------------------------ */

/** The direct link to these versions: copy it or send it to yourself, to listen and buy on any device. */
function PreviewLinkCard({ link, emailed, name }: { link: { url: string; expiresAt: string }; emailed: boolean; name: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  // The buyer's own clock and time zone.
  const until = new Date(link.expiresAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy your preview link:", link.url);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `${name}'s song`, url: link.url });
    } catch {
      /* the buyer closed the share sheet */
    }
  };
  return (
    <Card tone="muted" title="Save your preview link">
      <Note>
        Opens these versions on any device until {until}.{emailed ? " We've emailed it to you too." : ""} Anyone with the link can listen and buy, so keep it to yourself.
      </Note>
      <div className="ui-row ui-mt" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? "✓ Copied" : "Copy link"}
        </Button>
        {canShare && (
          <Button variant="text" onClick={() => void share()}>
            Send to myself…
          </Button>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------- versions --------------------------------- */

function Versions({ view, song }: { view: RequestView; song: Song }) {
  const { name, rel, giver } = names(view);
  const sections = useSections(view);
  const chorus = chorusOf(sections);
  const [allLyrics, setAllLyrics] = useState(false);
  const selected = view.candidates.find((c) => c.selected) ?? null;
  const paid = view.order?.status === "paid";
  const many = view.candidates.length > 1;

  return (
    <>
      <ScreenTitle
        eyebrow={paid ? "It's yours" : "Your free preview"}
        title={`${name}'s Song`}
        subtitle={`An original ${view.genreLabel} song written for ${name}, your ${rel}${giver ? `, from ${giver}` : ""}. Headphones in if you have them.`}
      />
      {!paid && many && <Note>{view.candidates.length} versions. Pick the one that gives you chills.</Note>}

      <div className="ui-stack ui-mt" role="radiogroup" aria-label="Song versions">
        {view.candidates.map((c, i) => (
          <div key={c.id} className="ui-stack">
            {c.purchaseStatus === "paid" && c.downloadUrl ? (
              <AudioPlayer src={c.downloadUrl} title={`${c.label} · full song`} seed={i + 1} />
            ) : c.previewUrl ? (
              <AudioPlayer
                src={c.previewUrl}
                title={c.label}
                seed={i + 1}
                onPlay={() => song.trackPlay("preview_play", c.id, i)}
                onEnded={() => song.trackPlay("preview_complete", c.id, i)}
              />
            ) : null}
            {c.description && <Note>{c.description}</Note>}
            {!paid && many && (
              <Button variant={c.selected ? "primary" : "secondary"} disabled={song.busy} onClick={() => void song.select(c.id)}>
                {c.selected ? "✓ Selected" : "Choose this version"}
              </Button>
            )}
            {c.purchaseStatus === "paid" && c.downloadUrl && (
              <Button variant="text" href={c.downloadUrl}>
                Download MP3
              </Button>
            )}
          </div>
        ))}
      </div>

      {!paid && (
        <div className="ui-mt ui-stack">
          <Button block disabled={song.busy || song.pendingOrder || (many && !selected)} onClick={() => void song.buy((selected ?? view.candidates[0]).id)}>
            {many && !selected ? "Choose a version first" : `🔓 Get ${name}'s full song · ${view.priceLabel}`}
          </Button>
          <TrustRow items={["The full song, every verse", "MP3 download", "The full lyrics"]} />
          {song.pendingOrder && <Note>Waiting for payment confirmation. This page updates on its own.</Note>}
          {view.order?.status === "paid_unfulfilled" && <ErrorText>Your payment went through but we couldn&apos;t prepare the file. We&apos;ve been notified and will deliver it.</ErrorText>}
        </div>
      )}
      {!paid && view.previewLink && <PreviewLinkCard link={view.previewLink} emailed={view.previewLinkEmailed} name={name} />}
      {paid && view.order?.deliveryLink && (
        <Card tone="muted" title="Keep this link">
          <Note>
            Your permanent link to {name}&apos;s song: <a href={view.order.deliveryLink}>{typeof window !== "undefined" ? window.location.origin : ""}{view.order.deliveryLink}</a>
          </Note>
        </Card>
      )}
      {view.rejectedCount > 0 && (
        <div className="ui-mt">
          <Note>
            {view.rejectedCount} recording{view.rejectedCount > 1 ? "s" : ""} didn&apos;t pass our quality checks and {view.rejectedCount > 1 ? "were" : "was"} left out.
          </Note>
        </div>
      )}

      {!paid && view.draft && <LockedLyrics view={view} title="The full lyrics" />}

      {paid && chorus && (
        <Card title={allLyrics ? "The lyrics" : "The chorus"}>
          <Lyrics sections={allLyrics ? sections : [chorus]} legend="Highlighted lines came from your story. Tap one to see." />
          <Button variant="text" onClick={() => setAllLyrics((a) => !a)}>
            {allLyrics ? "Show just the chorus" : "See all the lyrics"}
          </Button>
        </Card>
      )}

      {!paid && view.generation.canRequestMore && (
        <Card tone="muted" title="Want to hear it another way?">
          <Note>We'll record another take of {name}&apos;s song, free.</Note>
          <div className="ui-row ui-mt">
            <Button variant="text" disabled={song.busy} onClick={() => void song.moreTakes()}>
              Hear another take
            </Button>
          </div>
        </Card>
      )}
      {paid && view.supportEmail && (
        <Note>
          Spot a wrong word or name? Email <a href={`mailto:${view.supportEmail}`}>{view.supportEmail}</a> and we&apos;ll fix it free.
        </Note>
      )}

      {view.showFeedback && <FeedbackCard song={song} versionId={selected?.id ?? null} given={view.feedback} priceLabel={view.priceLabel} />}
    </>
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

const RATINGS = [
  { n: 1, label: "Not for me" },
  { n: 2, label: "Meh" },
  { n: 3, label: "Nice" },
  { n: 4, label: "Loved it" },
  { n: 5, label: "Gave me chills" },
];

/** MVP test feedback: how the song landed, and whether the tester would pay for it. */
function FeedbackCard({ song, versionId, given, priceLabel }: { song: Song; versionId: string | null; given: RequestView["feedback"]; priceLabel: string }) {
  const [rating, setRating] = useState<number | null>(given?.rating ?? null);
  const [wouldPay, setWouldPay] = useState<"yes" | "maybe" | "no" | null>((given?.wouldPay as "yes" | "maybe" | "no" | null) ?? null);
  const [note, setNote] = useState(given?.note ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(given ? "sent" : "idle");
  const edit = () => setState("idle");

  return (
    <Card title="How did it land?">
      <Note>We&apos;re testing this. Your honest reaction helps more than anything.</Note>
      <div className="ui-mt">
        <Chips>
          {RATINGS.map((r) => (
            <Chip key={r.n} selected={rating === r.n} onClick={() => { setRating(r.n); edit(); }}>
              {r.label}
            </Chip>
          ))}
        </Chips>
      </div>
      <p className="ui-mt ui-field__label">Would you pay {/^\$/.test(priceLabel) ? priceLabel : "for this"} as a gift?</p>
      <div className="ui-mt">
        <Chips>
          {(["yes", "maybe", "no"] as const).map((w) => (
            <Chip key={w} selected={wouldPay === w} onClick={() => { setWouldPay(w); edit(); }}>
              {w === "yes" ? "Yes" : w === "maybe" ? "Maybe" : "No"}
            </Chip>
          ))}
        </Chips>
      </div>
      <div className="ui-mt">
        <TextArea style={{ minHeight: 80 }} placeholder="Anything that felt off, or a line you loved? (optional)" value={note} onChange={(e) => { setNote(e.target.value); edit(); }} />
      </div>
      <div className="ui-row ui-mt">
        <Button
          disabled={!rating || state === "sending" || state === "sent"}
          onClick={async () => {
            if (!rating) return;
            setState("sending");
            setState((await song.sendFeedback({ rating, wouldPay, note, versionId })) ? "sent" : "error");
          }}
        >
          {state === "sent" ? "Thanks, saved" : state === "sending" ? "Saving…" : "Send feedback"}
        </Button>
        {state === "error" && <ErrorText>Couldn&apos;t save that. Try again.</ErrorText>}
      </div>
    </Card>
  );
}

/* ------------------------------- locked lyrics ------------------------------- */

/** "2 verses, a chorus and a bridge" from the section names the server sends (never the words). */
function describeSections(sections: string[]): string {
  const verses = sections.filter((x) => x === "verse").length;
  const parts = [
    verses ? `${verses === 1 ? "a verse" : `${verses} verses`}` : "",
    sections.some((x) => x.includes("chorus") && !x.includes("pre")) ? "a chorus" : "",
    sections.some((x) => x.includes("bridge")) ? "a bridge" : "",
  ].filter(Boolean);
  if (!parts.length) return "The lyrics";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The lyrics before purchase: what they hold, blurred, with the promise that they come with the song. */
function LockedLyrics({ view, title }: { view: RequestView; title: string }) {
  const shape = view.draft?.shape;
  const what = describeSections(shape?.sections ?? []);
  const fromStory = shape?.storyLineCount ?? 0;
  return (
    <Card title={title}>
      <div className="ui-locked" aria-hidden>
        {[82, 64, 90, 58, 76, 86].map((w, i) => (
          <span key={i} className={i % 3 === 1 ? "ui-locked__line ui-locked__line--story" : "ui-locked__line"} style={{ width: `${w}%` }} />
        ))}
      </div>
      <Note>
        🔒 {what.charAt(0).toUpperCase() + what.slice(1)}
        {fromStory > 0 ? `, with ${fromStory} line${fromStory === 1 ? "" : "s"} built from your story` : ""}. You&apos;ll hear how they fit in the preview, and get every word with the full song.
      </Note>
    </Card>
  );
}

/* ----------------------- review (lyrics need a look) ----------------------- */

function Review({ view, song }: { view: RequestView; song: Song }) {
  const { name } = names(view);
  const sections = useSections(view);
  const [editing, setEditing] = useState(false);
  const draft = view.draft;
  if (!draft) return null;
  const blocked = !draft.singable;
  if (draft.locked) {
    // Lyrics stay a surprise until the song is bought: offer a fresh version or recording, never the words.
    return (
      <>
        <ScreenTitle
          title={blocked ? `We're giving ${name}'s lyrics another pass` : `${name}'s lyrics are ready`}
          subtitle={blocked ? "Our checks flagged something before recording. We'll write a fresh version, then record it." : "Ready when you are. You'll hear the preview in a few minutes."}
        />
        <LockedLyrics view={view} title="The lyrics are a surprise" />
        <div className="ui-row">
          {!blocked && (
            <Button disabled={song.busy} onClick={() => void song.record(draft.id)}>
              Record it
            </Button>
          )}
          <Button variant={blocked ? "primary" : "text"} disabled={song.busy} onClick={() => void song.newLyrics()}>
            Write new lyrics
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <ScreenTitle
        title={blocked ? `${name}'s lyrics need a small fix` : `${name}'s lyrics are ready`}
        subtitle={blocked ? "Our checks flagged something before we sing it. Change the line, or ask for new lyrics." : "Read them through, then we'll record."}
      />
      {blocked && draft.blockingIssues.length > 0 && (
        <Card tone="muted">
          <Checklist items={draft.blockingIssues.map((i) => `${i.section ? `${i.section}: ` : ""}${i.reason}`)} />
        </Card>
      )}
      <Card title={draft.title}>
        {editing ? <EditLyrics initial={draft.displayLyrics} song={song} onDone={() => setEditing(false)} /> : <Lyrics sections={sections} legend="Highlighted lines came from your story." />}
      </Card>
      {!editing && (
        <div className="ui-row">
          <Button disabled={song.busy || blocked} onClick={() => void song.record(draft.id)}>
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
      <ScreenTitle title={`One more thing about ${name}`} subtitle="A small, specific detail will make the song unmistakably about them." />
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
  // Recording failed: record again. Writing failed before any usable lyrics: write them again.
  const canRecord = !!view.draft?.singable && view.generation.canRequestMore;
  const canRewrite = !canRecord && !!view.brief;
  const retry = canRecord ? () => song.record() : canRewrite ? () => song.newLyrics() : null;
  return (
    <>
      <ScreenTitle
        title={`We hit a snag with ${name}'s song`}
        subtitle={retry ? "It happens now and then, and trying again almost always works. Your story is saved." : "Sorry about that. You can start a new song below."}
      />
      <Card>
        {retry ? (
          <Button block disabled={song.busy} onClick={() => void retry()}>
            {song.busy ? "Starting…" : "Try again"}
          </Button>
        ) : (
          <Button block href="/create">
            Start a new song
          </Button>
        )}
        <div className="ui-mt">
          <Note>If it keeps happening, reply to your email with this code: {view.id.slice(0, 8)}</Note>
        </div>
      </Card>
    </>
  );
}

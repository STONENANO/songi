"use client";
/**
 * The quiz screens. Layout and copy only; behaviour comes from use-quiz.ts.
 * Re-skin by editing components/ui and app/theme.css, not these files.
 */
import { useEffect, useRef, useState } from "react";
import {
  Bubble,
  Button,
  Card,
  Chip,
  Chips,
  Collapse,
  Picked,
  Quote,
  Recap,
  DetailToLyric,
  ErrorText,
  Field,
  IngredientsTray,
  Note,
  ScreenTitle,
  StrengthMeter,
  TextArea,
  TextInput,
  Tile,
  Tiles,
  Tip,
  TrustRow,
} from "@/components/ui";
import { DETAIL_EXAMPLES, FEELINGS, OCCASIONS, OTHER, RELATIONSHIPS, TRUST, feelingsFor, threadByKey, threadsFor } from "@/lib/onboarding/content";
import { CUSTOM_GENRE, MAX_PROBES, MAX_THREADS, MIN_ANSWER_CHARS, MIN_THREADS, RECOMMENDED_THREADS, track, type Quiz } from "./use-quiz";

export type Genre = { key: string; label: string; tagline: string };

/**
 * Each screen returns its body and its footer, so the shell can place the footer in the sticky bar.
 * Screens may use hooks: the shell mounts each step as its own keyed component (see quiz.tsx).
 */
export type ScreenParts = { body: React.ReactNode; footer: React.ReactNode };

const KEYBOARD_TIP = "Prefer talking? Tap the 🎤 on your keyboard and just speak.";

/* ------------------------------- Chapter 1 ------------------------------- */

const PRONOUN_CHOICES: { value: "she" | "he" | "they"; label: string }[] = [
  { value: "she", label: "She / her" },
  { value: "he", label: "He / him" },
  { value: "they", label: "They / them" },
];

/** Who it's for and their name, on one screen. */
export function WhoScreen(q: Quiz): ScreenParts {
  const [showSay, setShowSay] = useState(!!q.s.pronunciation);
  const nameRef = useRef<HTMLInputElement>(null);
  const picked = !!q.s.relationship;
  const name = q.s.recipientName.trim();
  const otherOk = !q.isOtherRel || q.s.relationshipOther.trim().length >= 2;
  const their = q.pronoun === "she" ? "her" : q.pronoun === "he" ? "his" : "their";
  const pick = (v: string) => {
    q.set("relationship", v);
    // Tiles go straight to the name; "Someone else" types who first.
    if (v !== OTHER) setTimeout(() => nameRef.current?.focus(), 50);
  };
  return {
    body: (
      <>
        <ScreenTitle title="Who's this song for?" subtitle="We'll write and sing a song about them, from your story." />
        {picked ? (
          <Picked emoji={q.rel?.emoji ?? "✨"} label={q.rel?.label ?? "Someone else"} onChange={() => q.set("relationship", "")} />
        ) : (
          <Tiles>
            {RELATIONSHIPS.map((r) => (
              <Tile key={r.value} emoji={r.emoji} label={r.label} selected={q.s.relationship === r.value} onClick={() => pick(r.value)} />
            ))}
            <Tile emoji="✨" label="Someone else" selected={q.isOtherRel} onClick={() => pick(OTHER)} />
          </Tiles>
        )}
        {q.isOtherRel && (
          <div className="ui-mt">
            <Field label="Who are they to you?">
              <TextInput autoFocus value={q.s.relationshipOther} onChange={(e) => q.set("relationshipOther", e.target.value)} placeholder="e.g. my sister, best friend, my coach" maxLength={40} />
            </Field>
            <Chips>
              {PRONOUN_CHOICES.map((p) => (
                <Chip key={p.value} selected={q.pronoun === p.value} onClick={() => q.set("pronounOther", p.value)}>
                  {p.label}
                </Chip>
              ))}
            </Chips>
          </div>
        )}
        {picked && (
          <div className="ui-mt">
            <Field label={`What's ${their} name?`} hint={name ? `We'll sing “${name}” in the chorus.` : "First name or the nickname you call them."}>
              <TextInput
                ref={nameRef}
                value={q.s.recipientName}
                onChange={(e) => q.set("recipientName", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name && otherOk && q.next()}
                placeholder="Name"
                maxLength={60}
                autoComplete="off"
                enterKeyHint="next"
                aria-label="Their name"
              />
            </Field>
            {showSay ? (
              <Field label="How do you say it?" hint="Spell it how it sounds, e.g. Shiv-awn for Siobhan.">
                <TextInput value={q.s.pronunciation} onChange={(e) => q.set("pronunciation", e.target.value)} placeholder="Shiv-awn" maxLength={60} />
              </Field>
            ) : (
              <Button variant="text" onClick={() => setShowSay(true)}>Unusual name? Tell us how to say it</Button>
            )}
          </div>
        )}
      </>
    ),
    footer: (
      <>
        <Button block disabled={!picked || !name || !otherOk} onClick={q.next}>
          Continue
        </Button>
        <TrustRow items={TRUST} />
      </>
    ),
  };
}

export function OccasionScreen(q: Quiz): ScreenParts {
  const otherOk = !q.isOtherOcc || q.s.occasionOther.trim().length >= 2;
  const pick = (v: string) => {
    q.set("occasion", v);
    if (v !== OTHER) setTimeout(q.next, 180);
  };
  return {
    body: (
      <>
        <ScreenTitle title={`What's the occasion for ${q.name}?`} />
        {q.isOtherOcc ? (
          <Picked emoji="✏️" label="Something else" onChange={() => q.set("occasion", "")} />
        ) : (
          <Tiles>
            {OCCASIONS.map((o) => (
              <Tile key={o.value} emoji={o.emoji} label={o.label} selected={q.s.occasion === o.value} onClick={() => pick(o.value)} />
            ))}
            <Tile emoji="✏️" label="Something else" selected={q.isOtherOcc} onClick={() => pick(OTHER)} />
          </Tiles>
        )}
        {q.isOtherOcc && (
          <div className="ui-mt">
            <Field label="What's the occasion?">
              <TextInput autoFocus value={q.s.occasionOther} onChange={(e) => q.set("occasionOther", e.target.value)} onKeyDown={(e) => e.key === "Enter" && otherOk && q.next()} placeholder="e.g. graduation, retirement, in memory" maxLength={40} />
            </Field>
          </div>
        )}
      </>
    ),
    footer: (
      <Button block disabled={!q.s.occasion || !otherOk} onClick={q.next}>
        Continue
      </Button>
    ),
  };
}

/* ------------------------------- Chapter 2 ------------------------------- */

/** Pick story topics, with the "detail becomes a lyric" example on top. */
export function ThreadsScreen(q: Quiz): ScreenParts {
  const options = threadsFor(q.group);
  const n = q.s.threads.length;
  const ex = DETAIL_EXAMPLES[q.group];
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Chapter 2 of 3" title={`What should ${q.name}'s song be about?`} subtitle={`Pick up to ${MAX_THREADS}. We recommend ${RECOMMENDED_THREADS}: we'll ask one quick question about each.`} />
        {/* The example plays once, then folds away so the topics move up. Skipped when coming back. */}
        <Collapse ms={2800} closed={n > 0}>
          <Card tone="muted">
            <DetailToLyric animate from={ex.from} to={ex.to} />
          </Card>
        </Collapse>
        <Tiles>
          {options.map((t) => {
            const on = q.s.threads.includes(t.key);
            return <Tile key={t.key} multi emoji={t.emoji} label={q.f(t.label)} selected={on} onClick={() => q.toggleThread(t.key)} />;
          })}
        </Tiles>
      </>
    ),
    footer: (
      <>
        <Button block disabled={n < MIN_THREADS} onClick={q.next}>
          {n === 0 ? "Pick a topic" : "Continue"}
        </Button>
        <p className="ui-footer__note">
          {n === 0
            ? "Plain sentences are perfect, and you can skip anything."
            : n < RECOMMENDED_THREADS
              ? `Tip: add one more for a richer song (${n}/${MAX_THREADS})`
              : `${n}/${MAX_THREADS} picked · great choice`}
        </p>
      </>
    ),
  };
}

type Phase = "write" | "thinking" | "followup" | "reacted";

/** One story question, with the dig-deeper follow-up. */
export function QuestionScreen(q: Quiz, thread: string): ScreenParts {
  const t = threadByKey(thread)!;
  const a = q.s.answers[thread] ?? { answer: "", followUp: "", followUpAnswer: "", probed: false };
  // Coming back to an answered question: show its follow-up again rather than re-asking.
  const [phase, setPhase] = useState<Phase>(a.followUp ? "followup" : "write");
  const [reaction, setReaction] = useState("");
  const question = q.f(t.question);
  const pos = q.s.threads.indexOf(thread);
  const others = q.s.threads.filter((x) => x !== thread);
  const canSkip = others.some((x) => (q.s.answers[x]?.answer ?? "").trim().length >= MIN_ANSWER_CHARS) || pos < q.s.threads.length - 1;

  const insertStarter = (starter: string) => {
    const text = q.f(starter).replace(/…$/, " ");
    const cur = phase === "followup" ? a.followUpAnswer : a.answer;
    const next = cur.trim() ? `${cur.trim()} ${text}` : text;
    q.setAnswer(thread, phase === "followup" ? { followUpAnswer: next } : { answer: next });
  };

  const submitAnswer = async () => {
    if (a.probed || q.probesUsed >= MAX_PROBES) {
      // Still collect ingredients, but don't wait for them.
      void q.probe(thread, question, a.answer, true, 2500).then((r) => r && q.addIngredients(r.ingredients));
      q.next();
      return;
    }
    setPhase("thinking");
    const r = await q.probe(thread, question, a.answer, false, 3500);
    q.setAnswer(thread, { probed: true });
    if (r) q.addIngredients(r.ingredients);
    const followUp = r ? r.followUp : a.answer.trim().length < 60 ? q.f(t.dig) : "";
    setReaction(r?.reaction ?? "");
    if (followUp) {
      q.setAnswer(thread, { followUp, probed: true });
      track("quiz:followup_shown", { thread });
      setPhase("followup");
    } else {
      setPhase("reacted");
      setTimeout(q.next, r?.reaction ? 1300 : 0);
    }
  };

  const submitFollowUp = () => {
    track("quiz:followup_answered", { thread });
    void q.probe(thread, a.followUp, a.followUpAnswer, true, 2500).then((r) => r && q.addIngredients(r.ingredients));
    q.next();
  };

  const skip = () => {
    track(phase === "followup" ? "quiz:followup_skipped" : "quiz:question_skipped", { thread });
    q.next();
  };

  const body = (
    <>
      <IngredientsTray items={q.s.ingredients} strength={q.strength} />
      <ScreenTitle
        eyebrow={`${t.emoji} ${q.f(t.label)} · ${pos + 1} of ${q.s.threads.length}`}
        title={question}
        subtitle={q.f(t.hint)}
      />
      {phase === "write" ? (
        <TextArea
          value={a.answer}
          onChange={(e) => q.setAnswer(thread, { answer: e.target.value, probed: false, followUp: "", followUpAnswer: "" })}
          placeholder={q.f(t.starters[0])}
          maxLength={2000}
          autoFocus
          aria-label={question}
        />
      ) : (
        // Shrunk once sent, so the follow-up and its answer box stay above the fold.
        <Quote>{a.answer}</Quote>
      )}
      {phase === "write" && (
        <div className="ui-stack ui-mt">
          <Chips>
            {t.starters.map((st) => (
              <Chip key={st} ghost onClick={() => insertStarter(st)}>
                {q.f(st)}
              </Chip>
            ))}
          </Chips>
          <Tip>{KEYBOARD_TIP}</Tip>
        </div>
      )}
      {phase === "thinking" && <Bubble typing />}
      {phase === "reacted" && reaction && <Bubble>{reaction}</Bubble>}
      {phase === "followup" && (
        <>
          <Bubble>
            {reaction && <p style={{ marginBottom: 6 }}>{reaction}</p>}
            <b>{a.followUp}</b>
          </Bubble>
          <TextArea
            value={a.followUpAnswer}
            onChange={(e) => q.setAnswer(thread, { followUpAnswer: e.target.value })}
            placeholder="Even one sentence helps."
            maxLength={2000}
            autoFocus
            style={{ minHeight: 100 }}
            aria-label={a.followUp}
          />
        </>
      )}
    </>
  );

  const footer =
    phase === "followup" ? (
      <>
        <Button block disabled={a.followUpAnswer.trim().length < 3} onClick={submitFollowUp}>
          Add to the song
        </Button>
        <Button variant="text" onClick={skip}>Skip this one</Button>
      </>
    ) : (
      <>
        <Button block disabled={phase !== "write" || a.answer.trim().length < MIN_ANSWER_CHARS} onClick={submitAnswer}>
          {phase === "thinking" ? "Reading…" : "Continue"}
        </Button>
        {phase === "write" && canSkip && <Button variant="text" onClick={skip}>Skip this question</Button>}
      </>
    );

  return { body, footer };
}

export function OneLineScreen(q: Quiz): ScreenParts {
  return {
    body: (
      <>
        <IngredientsTray items={q.s.ingredients} strength={q.strength} />
        <ScreenTitle
          eyebrow="The heart of the song"
          title={`If this song could say one thing to ${q.name} that's hard to say out loud, what would it be?`}
          subtitle="We'll build the chorus around it."
        />
        <TextArea value={q.s.oneLine} onChange={(e) => q.set("oneLine", e.target.value)} placeholder={q.f("I don't say it enough, but…")} maxLength={300} style={{ minHeight: 110 }} autoFocus />
        <div className="ui-mt">
          <Tip>{KEYBOARD_TIP}</Tip>
        </div>
      </>
    ),
    footer: (
      <>
        <Button block disabled={q.s.oneLine.trim().length < 5} onClick={q.next}>
          Continue
        </Button>
        <Button variant="text" onClick={q.next}>You write it for me</Button>
      </>
    ),
  };
}

export function FeelingScreen(q: Quiz): ScreenParts {
  const feelings = feelingsFor(q.group, q.gentle);
  const [showLeaveOut, setShowLeaveOut] = useState(!!q.s.leaveOut);
  const label = q.strength >= 4 ? "Strong story" : q.strength >= 2 ? "Good story" : "A good start";
  const details = q.s.ingredients.length + (q.s.oneLine.trim() ? 1 : 0);
  return {
    body: (
      <>
        <ScreenTitle title={`When ${q.name} hears this, you want ${q.pronoun === "she" ? "her" : q.pronoun === "he" ? "him" : "them"} to…`} />
        <Tiles>
          {feelings.map((fe) => (
            <Tile key={fe.value} emoji={fe.emoji} label={fe.label} selected={q.s.feeling === fe.value} onClick={() => q.set("feeling", fe.value)} />
          ))}
        </Tiles>
        <div className="ui-mt">
          {showLeaveOut ? (
            <Field label="Anything we should leave out?" hint="An ex, a loss, a nickname they hate. We'll keep it out of the song.">
              <TextInput autoFocus value={q.s.leaveOut} onChange={(e) => q.set("leaveOut", e.target.value)} placeholder="e.g. don't mention the divorce" maxLength={300} />
            </Field>
          ) : (
            <Button variant="text" onClick={() => setShowLeaveOut(true)}>Anything we should leave out?</Button>
          )}
        </div>
        <Card tone="muted">
          <div className="ui-row" style={{ justifyContent: "space-between" }}>
            <b>{label} ✓</b>
            <StrengthMeter level={q.strength} />
          </div>
          <Note>
            {details > 0
              ? `We have ${details} real detail${details === 1 ? "" : "s"} about ${q.name} to sing about.`
              : `We'll write from what you've told us about ${q.name}.`}
          </Note>
        </Card>
      </>
    ),
    footer: (
      <Button block disabled={!q.s.feeling} onClick={q.next}>
        Continue
      </Button>
    ),
  };
}

/* ------------------------------- Chapter 3 ------------------------------- */

export function SoundScreen(q: Quiz, genres: Genre[]): ScreenParts {
  const custom = q.s.genreKey === CUSTOM_GENRE;
  const ready = !!q.s.genreKey && (!custom || q.s.customStyle.trim().length >= 3);
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Chapter 3 of 3" title={`What should ${q.name}'s song sound like?`} />
        {q.s.genreKey ? (
          <Picked
            label={custom ? "Something else" : (genres.find((g) => g.key === q.s.genreKey)?.label ?? "")}
            sub={custom ? "Describe the sound you want" : genres.find((g) => g.key === q.s.genreKey)?.tagline}
            onChange={() => q.set("genreKey", "")}
          />
        ) : (
          <Tiles>
            {genres.map((g) => (
              <Tile key={g.key} label={g.label} sub={g.tagline} selected={false} onClick={() => q.set("genreKey", g.key)} />
            ))}
            <Tile label="Something else" sub="Describe the sound you want" selected={false} onClick={() => q.set("genreKey", CUSTOM_GENRE)} />
          </Tiles>
        )}
        {custom && (
          <div className="ui-mt">
            <Field label="Describe the sound" hint="Describe sounds, not artists: “slow soul with a choir at the end”, “90s pop-punk”.">
              <TextInput autoFocus value={q.s.customStyle} onChange={(e) => q.set("customStyle", e.target.value)} placeholder="e.g. soft piano ballad that builds" maxLength={300} />
            </Field>
          </div>
        )}
        {q.s.genreKey && (
          <>
            <h2 className="ui-card__title ui-mt">Singer</h2>
            <Chips>
              {(["f", "m", "any"] as const).map((v) => (
                <Chip key={v} selected={q.s.vocalGender === v} onClick={() => q.set("vocalGender", v)}>
                  {v === "f" ? "Female voice" : v === "m" ? "Male voice" : "Surprise me"}
                </Chip>
              ))}
            </Chips>
          </>
        )}
      </>
    ),
    footer: (
      <Button block disabled={!ready} onClick={q.next}>
        Continue
      </Button>
    ),
  };
}

/** Pre-checkout: a recap of the song they've built, then where to send it. */
export function SendScreen(q: Quiz, genres: Genre[]): ScreenParts {
  const [showPhone, setShowPhone] = useState(!!q.s.phone);
  const [showRecap, setShowRecap] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.s.email.trim());
  // "my sister" -> "sister", so it reads "your sister".
  const who = q.isOtherRel ? q.s.relationshipOther.trim().replace(/^(my|our)\s+/i, "") : (q.rel?.label ?? "");
  const occasion = q.isOtherOcc ? q.s.occasionOther.trim() : (q.occasion?.label ?? "");
  const topics = q.s.threads.map((t) => threadByKey(t)).filter(Boolean).map((t) => q.f(t!.label));
  const feeling = FEELINGS.find((x) => x.value === q.s.feeling);
  const sound = q.s.genreKey === CUSTOM_GENRE ? q.s.customStyle.trim() : (genres.find((g) => g.key === q.s.genreKey)?.label ?? "");
  const voice = q.s.vocalGender === "f" ? "female voice" : q.s.vocalGender === "m" ? "male voice" : "any voice";
  const details = q.s.ingredients.length + (q.s.oneLine.trim() ? 1 : 0);
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Almost there" title={`${q.name}'s song is ready to write`} />
        <Card tone="muted">
          <p>
            <b>{q.name}</b>
            {who ? ` (your ${who.toLowerCase()})` : ""} · {occasion} · {sound}
          </p>
          <Note>
            About {topics.join(" & ").toLowerCase()}
            {details ? `, with ${details} real details` : ""}.{" "}
            <button type="button" className="ui-recap__edit" onClick={() => setShowRecap((v) => !v)}>
              {showRecap ? "Hide details" : "Check or edit"}
            </button>
          </Note>
          {showRecap && (
            <div className="ui-mt">
              <Recap
                rows={[
                  { label: "For", value: <><b>{q.name}</b>{who ? `, your ${who.toLowerCase()}` : ""}</>, onEdit: () => q.editFromRecap("who") },
                  { label: "Occasion", value: occasion, onEdit: () => q.editFromRecap("occasion") },
                  { label: "About", value: topics.join(" · ") + (details ? ` (${details} details)` : ""), onEdit: () => q.goTo("threads") },
                  ...(feeling ? [{ label: "Feeling", value: `${feeling.emoji} ${feeling.label}`, onEdit: () => q.editFromRecap("feeling") }] : []),
                  { label: "Sound", value: `${sound}, ${voice}`, onEdit: () => q.editFromRecap("sound") },
                ]}
              />
            </div>
          )}
        </Card>
        <Field label="Where should we send it?" hint="Your free preview plays on the next screen. We'll email you the link too.">
          <TextInput type="email" inputMode="email" autoComplete="email" value={q.s.email} onChange={(e) => q.set("email", e.target.value)} placeholder="you@example.com" aria-label="Your email" />
        </Field>
        <Field label="Who's it from? (optional)">
          <TextInput value={q.s.giverName} onChange={(e) => q.set("giverName", e.target.value)} placeholder="Your first name" autoComplete="given-name" maxLength={60} />
        </Field>
        {showPhone ? (
          <Field label="Mobile number (optional)" hint="We'll text you when it's ready.">
            <TextInput type="tel" inputMode="tel" autoComplete="tel" value={q.s.phone} onChange={(e) => q.set("phone", e.target.value)} placeholder="(555) 123-4567" maxLength={30} />
          </Field>
        ) : (
          <Button variant="text" onClick={() => setShowPhone(true)}>Text it to me too</Button>
        )}
        {q.error && <ErrorText>{q.error}</ErrorText>}
      </>
    ),
    footer: (
      <>
        <Button block disabled={!emailOk || q.busy} onClick={q.submit}>
          {q.busy ? "Starting…" : `Write ${q.name}'s song`}
        </Button>
        <TrustRow items={["Free preview", "No card needed", "Change any line later"]} />
      </>
    ),
  };
}

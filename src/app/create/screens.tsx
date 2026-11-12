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
import { DETAIL_EXAMPLES, NEEDED_BY, OCCASIONS, RELATIONSHIPS, TRUST, feelingsFor, threadByKey, threadsFor } from "@/lib/onboarding/content";
import { MAX_PROBES, MAX_THREADS, MIN_ANSWER_CHARS, MIN_THREADS, track, type Quiz } from "./use-quiz";

export type Genre = { key: string; label: string; tagline: string };

/**
 * Each screen returns its body and its footer, so the shell can place the footer in the sticky bar.
 * Screens may use hooks: the shell mounts each step as its own keyed component (see quiz.tsx).
 */
export type ScreenParts = { body: React.ReactNode; footer: React.ReactNode };

const KEYBOARD_TIP = "Prefer talking? Tap the 🎤 on your keyboard and just speak.";

/* ------------------------------- Chapter 1 ------------------------------- */

export function WhoScreen(q: Quiz): ScreenParts {
  const pick = (v: string) => {
    q.set("relationship", v);
    setTimeout(q.next, 180);
  };
  return {
    body: (
      <>
        <ScreenTitle title="Who's this song for?" subtitle="We'll write and sing a song about them, from your story." />
        <Tiles>
          {RELATIONSHIPS.map((r) => (
            <Tile key={r.value} emoji={r.emoji} label={r.label} selected={q.s.relationship === r.value} onClick={() => pick(r.value)} />
          ))}
        </Tiles>
      </>
    ),
    footer: <TrustRow items={TRUST} />,
  };
}

export function NameScreen(q: Quiz): ScreenParts {
  const [showSay, setShowSay] = useState(!!q.s.pronunciation);
  const name = q.s.recipientName.trim();
  const their = q.pronoun === "she" ? "her" : q.pronoun === "he" ? "his" : "their";
  return {
    body: (
      <>
        <ScreenTitle title={`What's ${their} name?`} subtitle="First name or the nickname you call them." />
        <TextInput
          hero
          autoFocus
          value={q.s.recipientName}
          onChange={(e) => q.set("recipientName", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name && q.next()}
          placeholder="Name"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="next"
          aria-label="Their name"
        />
        <div className="ui-mt ui-center">
          {name ? <Note>We&apos;ll sing <b>{name}</b> in the chorus.</Note> : <Note>&nbsp;</Note>}
        </div>
        <div className="ui-mt">
          {showSay ? (
            <Field label="How do you say it?" hint="Spell it how it sounds, e.g. Shiv-awn for Siobhan.">
              <TextInput value={q.s.pronunciation} onChange={(e) => q.set("pronunciation", e.target.value)} placeholder="Shiv-awn" maxLength={60} />
            </Field>
          ) : (
            <div className="ui-center">
              <Button variant="text" onClick={() => setShowSay(true)}>Unusual name? Tell us how to say it</Button>
            </div>
          )}
        </div>
      </>
    ),
    footer: (
      <Button block disabled={!name} onClick={q.next}>
        Continue
      </Button>
    ),
  };
}

export function OccasionScreen(q: Quiz): ScreenParts {
  return {
    body: (
      <>
        <ScreenTitle title={`What's the occasion for ${q.name}?`} />
        <Tiles>
          {OCCASIONS.map((o) => (
            <Tile key={o.value} emoji={o.emoji} label={o.label} selected={q.s.occasion === o.value} onClick={() => q.set("occasion", o.value)} />
          ))}
        </Tiles>
        <h2 className="ui-card__title ui-mt">When do you need it?</h2>
        <Chips>
          {NEEDED_BY.map((n) => (
            <Chip key={n.value} selected={q.s.neededBy === n.value} onClick={() => q.set("neededBy", q.s.neededBy === n.value ? "" : n.value)}>
              {n.label}
            </Chip>
          ))}
        </Chips>
      </>
    ),
    footer: (
      <Button block disabled={!q.s.occasion} onClick={q.next}>
        Continue
      </Button>
    ),
  };
}

/* ------------------------------- Chapter 2 ------------------------------- */

export function StoryIntroScreen(q: Quiz): ScreenParts {
  const ex = DETAIL_EXAMPLES[q.group];
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Chapter 2 of 3" title="Now the good part." subtitle={`The best songs come from small, specific moments, not big words. A few quick questions about ${q.name}.`} />
        <Card tone="muted" title="Here's how it works">
          <DetailToLyric from={ex.from} to={ex.to} />
        </Card>
        <Note>You don&apos;t need to be a writer. Plain sentences are perfect, and you can skip anything.</Note>
      </>
    ),
    footer: (
      <Button block onClick={q.next}>
        Let&apos;s do it
      </Button>
    ),
  };
}

export function ThreadsScreen(q: Quiz): ScreenParts {
  const options = threadsFor(q.group);
  const n = q.s.threads.length;
  return {
    body: (
      <>
        <ScreenTitle title={`What should ${q.name}'s song be about?`} subtitle={`Pick ${MIN_THREADS} or ${MAX_THREADS}. We'll ask one quick question about each.`} />
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
          {n < MIN_THREADS ? `Pick ${MIN_THREADS - n} more` : "Continue"}
        </Button>
        <p className="ui-footer__note">{n}/{MAX_THREADS} picked</p>
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
      <TextArea
        value={a.answer}
        onChange={(e) => q.setAnswer(thread, { answer: e.target.value, probed: false, followUp: "", followUpAnswer: "" })}
        placeholder={q.f(t.starters[0])}
        maxLength={2000}
        readOnly={phase !== "write"}
        autoFocus={phase === "write"}
        aria-label={question}
      />
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
  const feelings = feelingsFor(q.group, q.occasion);
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
          <Field label="Anything we should leave out? (optional)" hint="An ex, a loss, a nickname they hate. We'll keep it out of the song.">
            <TextInput value={q.s.leaveOut} onChange={(e) => q.set("leaveOut", e.target.value)} placeholder="e.g. don't mention the divorce" maxLength={300} />
          </Field>
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
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Chapter 3 of 3" title={`What should ${q.name}'s song sound like?`} />
        <Tiles>
          {genres.map((g) => (
            <Tile key={g.key} label={g.label} sub={g.tagline} selected={q.s.genreKey === g.key} onClick={() => q.set("genreKey", g.key)} />
          ))}
        </Tiles>
        <h2 className="ui-card__title ui-mt">Singer</h2>
        <Chips>
          {(["f", "m", "any"] as const).map((v) => (
            <Chip key={v} selected={q.s.vocalGender === v} onClick={() => q.set("vocalGender", v)}>
              {v === "f" ? "Female voice" : v === "m" ? "Male voice" : "Surprise me"}
            </Chip>
          ))}
        </Chips>
      </>
    ),
    footer: (
      <Button block disabled={!q.s.genreKey} onClick={q.next}>
        Continue
      </Button>
    ),
  };
}

export function SendScreen(q: Quiz): ScreenParts {
  const [showPhone, setShowPhone] = useState(!!q.s.phone);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.s.email.trim());
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => emailRef.current?.focus(), []);
  return {
    body: (
      <>
        <ScreenTitle title={`Where should we send ${q.name}'s song?`} subtitle="Your free preview plays on the next screen. We'll also email you the link so you never lose it." />
        <Field label="Your email">
          <TextInput ref={emailRef} type="email" inputMode="email" autoComplete="email" value={q.s.email} onChange={(e) => q.set("email", e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label="Who's the song from? (optional)" hint={`So the song can say it's from you.`}>
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
        <TrustRow items={["Free preview", "No card needed"]} />
      </>
    ),
  };
}

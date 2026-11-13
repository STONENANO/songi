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
  revealAboveBar,
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
  TrustRow, MascotLoop } from "@/components/ui";
import { DETAIL_EXAMPLES, FEELINGS, OCCASIONS, OTHER, RELATIONSHIPS, TRUST, feelingsFor, threadByKey, threadsFor } from "@/lib/onboarding/content";
import { CUSTOM_GENRE, MAX_THREADS, MIN_THREADS, RECOMMENDED_THREADS, track, type Quiz } from "./use-quiz";
import { OTHER_ANSWER, formatFor, isAnswered, type BlanksFormat, type TapFormat } from "@/lib/onboarding/story-formats";
import { Turnstile } from "./turnstile";

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

/* ---------------------- One screen per story topic ---------------------- */

/** Picks the topic's format: tap answers, a fill-in story card, or a free text box. */
export function TopicScreen(q: Quiz, thread: string): ScreenParts {
  const fmt = formatFor(thread);
  if (fmt.kind === "tap") return TapTopic(q, thread, fmt);
  if (fmt.kind === "blanks") return BlanksTopic(q, thread, fmt);
  return OpenTopic(q, thread, fmt);
}

function topicHead(q: Quiz, thread: string) {
  const t = threadByKey(thread)!;
  const pos = q.s.threads.indexOf(thread);
  return { t, pos, eyebrow: `${t.emoji} ${q.f(t.label)} · ${pos + 1} of ${q.s.threads.length}` };
}

/** Skipping is allowed unless it would leave the story completely empty. */
function canSkipTopic(q: Quiz, thread: string) {
  const pos = q.s.threads.indexOf(thread);
  return q.answered.some((x) => x !== thread) || pos < q.s.threads.length - 1;
}

function skipTopic(q: Quiz, thread: string) {
  track("quiz:question_skipped", { thread });
  q.next();
}

/** Tap first, type second: answer tiles, a narrowing chip row, one optional detail. */
function TapTopic(q: Quiz, thread: string, fmt: TapFormat): ScreenParts {
  const { t, eyebrow } = topicHead(q, thread);
  const a = q.s.topics[thread] ?? {};
  const isOther = a.choice === OTHER_ANSWER;
  const follow = a.choice && !isOther ? (fmt.follow?.[a.choice] ?? fmt.follow?.["*"] ?? []) : [];
  const picked = fmt.answers.find((x) => x.label === a.choice);
  const ok = isAnswered(fmt, a);
  return {
    body: (
      <>
        <IngredientsTray items={q.ingredients} strength={q.strength} />
        <ScreenTitle eyebrow={eyebrow} title={q.f(t.question)} subtitle={a.choice ? undefined : "Tap one. You can add a detail after."} />
        {a.choice ? (
          <Picked emoji={picked?.emoji} label={q.f(a.choice)} onChange={() => q.setTopic(thread, { choice: "", follow: "", other: "", detail: "" })} />
        ) : (
          <Tiles>
            {fmt.answers.map((x) => (
              <Tile key={x.label} emoji={x.emoji} label={q.f(x.label)} onClick={() => q.setTopic(thread, { choice: x.label, follow: "" })} />
            ))}
          </Tiles>
        )}
        {isOther && (
          <div className="ui-mt">
            <Field label="Tell us in a few words">
              <TextInput autoFocus value={a.other ?? ""} onChange={(e) => q.setTopic(thread, { other: e.target.value })} placeholder="Type your answer" maxLength={80} />
            </Field>
          </div>
        )}
        {follow.length > 0 && (
          <div className="ui-mt ui-stack">
            <span className="ui-field__label">{q.f(fmt.followLabel ?? "")}</span>
            <Chips>
              {follow.map((o) => (
                <Chip key={o} selected={a.follow === o} onClick={() => q.setTopic(thread, { follow: a.follow === o ? "" : o })}>
                  {q.f(o)}
                </Chip>
              ))}
            </Chips>
          </div>
        )}
        {a.choice && (
          <div className="ui-mt">
            <Field label={<>Add one detail <span className="ui-note">(optional)</span></>} hint="💡 Tap the 🎤 on your keyboard to just say it.">
              <TextInput value={a.detail ?? ""} onChange={(e) => q.setTopic(thread, { detail: e.target.value })} placeholder={q.f(fmt.detail)} maxLength={160} />
            </Field>
          </div>
        )}
      </>
    ),
    footer: (
      <>
        <Button block disabled={!ok} onClick={q.next}>
          Continue
        </Button>
        {!a.choice && canSkipTopic(q, thread) ? (
          <Button variant="text" onClick={() => skipTopic(q, thread)}>Skip this question</Button>
        ) : (
          <p className="ui-footer__note">{!a.choice ? "One tap is enough to continue" : (a.detail ?? "").trim() ? "That detail makes it yours ✓" : "One detail makes the song more personal"}</p>
        )}
      </>
    ),
  };
}

/** Fill in the blanks: a story card with glowing gaps; suggestions dock above the button. */
function BlanksTopic(q: Quiz, thread: string, fmt: BlanksFormat): ScreenParts {
  const { t, eyebrow } = topicHead(q, thread);
  const vals = q.s.topics[thread]?.blanks ?? fmt.blanks.map(() => "");
  const firstEmpty = vals.findIndex((v) => !v.trim());
  const [active, setActive] = useState<number | null>(firstEmpty === -1 ? null : firstEmpty);
  const [typed, setTyped] = useState("");
  const filled = vals.filter((v) => v.trim()).length;
  const madlibRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the blank being filled visible above the docked suggestions.
    const el = madlibRef.current?.querySelector(".ui-blank--active");
    if (el) setTimeout(() => revealAboveBar(el), 60);
  }, [active]);

  const setVal = (i: number, v: string) => {
    const next = [...vals];
    next[i] = v;
    q.setTopic(thread, { blanks: next });
    const after = next.findIndex((x, j) => !x.trim() && j !== i);
    setActive(after === -1 ? null : after);
    setTyped("");
    track("quiz:blank_filled", { thread, blank: i });
  };
  const spec = active !== null ? fmt.blanks[active] : null;

  return {
    body: (
      <>
        <ScreenTitle eyebrow={eyebrow} title={q.f(t.question)} subtitle="Tap a blank to fill it in. Pick a suggestion or type your own." />
        <div className="ui-meter ui-mb">
          <div className="ui-meter__track">
            <div className="ui-meter__fill" style={{ width: `${(filled / vals.length) * 100}%` }} />
          </div>
          <span>
            {filled}/{vals.length}
          </span>
        </div>
        <div className="ui-madlib" ref={madlibRef}>
          {fmt.sentences.map((sentence, si) => (
            <span key={si}>
              {sentence.map((part, pi) =>
                typeof part === "number" ? (
                  <button
                    key={pi}
                    type="button"
                    className={["ui-blank", vals[part].trim() && "ui-blank--filled", active === part && "ui-blank--active"].filter(Boolean).join(" ")}
                    onClick={() => {
                      setActive(part);
                      setTyped(fmt.blanks[part].sugg.includes(vals[part]) ? "" : vals[part]);
                    }}
                    aria-label={q.f(fmt.blanks[part].label)}
                  >
                    {vals[part].trim() || "______"}
                  </button>
                ) : (
                  <span key={pi}>{q.f(part)}</span>
                ),
              )}{" "}
            </span>
          ))}
        </div>
        {filled === vals.length && <p className="ui-win ui-mt">✓ Beautiful. That&apos;s going in {q.name}&apos;s song.</p>}
      </>
    ),
    footer: (
      <>
        {spec && active !== null && (
          <div className="ui-dock">
            <div className="ui-dock__head">
              <span>{q.f(spec.label)}</span>
              <Button variant="text" onClick={() => setActive(fmt.blanks.findIndex((_, j) => j > active && !vals[j].trim()) === -1 ? null : fmt.blanks.findIndex((_, j) => j > active && !vals[j].trim()))}>
                Skip blank
              </Button>
            </div>
            <Chips>
              {spec.sugg.map((sg) => (
                <Chip key={sg} selected={vals[active] === q.f(sg)} onClick={() => setVal(active, q.f(sg))}>
                  {q.f(sg)}
                </Chip>
              ))}
            </Chips>
            <div className="ui-dock__row">
              <TextInput
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && typed.trim() && setVal(active, typed.trim())}
                placeholder="Or type your own…"
                maxLength={80}
                enterKeyHint="done"
              />
              <Button disabled={!typed.trim()} onClick={() => setVal(active, typed.trim())}>
                Fill
              </Button>
            </div>
          </div>
        )}
        <Button block disabled={filled === 0} onClick={q.next}>
          Continue
        </Button>
        {filled === 0 && canSkipTopic(q, thread) ? (
          <Button variant="text" onClick={() => skipTopic(q, thread)}>Skip this card</Button>
        ) : (
          <p className="ui-footer__note">{filled === 0 ? "Fill any blank to continue" : filled < vals.length ? `${vals.length - filled} left, or keep going` : "Card complete ✓"}</p>
        )}
      </>
    ),
  };
}

/** Free text, for "Something else". */
function OpenTopic(q: Quiz, thread: string, fmt: { placeholder: string }): ScreenParts {
  const { t, eyebrow } = topicHead(q, thread);
  const a = q.s.topics[thread] ?? {};
  return {
    body: (
      <>
        <IngredientsTray items={q.ingredients} strength={q.strength} />
        <ScreenTitle eyebrow={eyebrow} title={q.f(t.question)} subtitle={q.f(t.hint)} />
        <TextArea value={a.text ?? ""} onChange={(e) => q.setTopic(thread, { text: e.target.value })} placeholder={q.f(fmt.placeholder)} maxLength={1500} autoFocus aria-label={q.f(t.question)} />
        <div className="ui-mt">
          <Tip>{KEYBOARD_TIP}</Tip>
        </div>
      </>
    ),
    footer: (
      <>
        <Button block disabled={!isAnswered(formatFor(thread), a)} onClick={q.next}>
          Continue
        </Button>
        {canSkipTopic(q, thread) && <Button variant="text" onClick={() => skipTopic(q, thread)}>Skip this question</Button>}
      </>
    ),
  };
}

/** The open box: the one thing to say, and anything else they want in the song. Both optional. */
export function LastTouchesScreen(q: Quiz): ScreenParts {
  const [more, setMore] = useState(!!(q.s.oneLine.trim() || q.s.anythingElse.trim()));
  const empty = !q.s.oneLine.trim() && !q.s.anythingElse.trim() && !Object.values(q.s.boosters).some((v) => v.trim());
  const openFields = (
    <>
      <Field label={`The one thing you want the song to tell ${q.name}`} hint="We'll build the chorus around it.">
        <TextArea value={q.s.oneLine} onChange={(e) => q.set("oneLine", e.target.value)} placeholder={q.f("I don't say it enough, but…")} maxLength={300} style={{ minHeight: 76 }} />
      </Field>
      <Field label="Anything else" hint="Memories, names, words to use, even lines you've written yourself.">
        <TextArea value={q.s.anythingElse} onChange={(e) => q.set("anythingElse", e.target.value)} placeholder="Write as much or as little as you like…" maxLength={1500} style={{ minHeight: 110 }} />
      </Field>
    </>
  );
  // Thin story: two quick sentence starters first, so we have enough before the email.
  if (q.thin) {
    return {
      body: (
        <>
          <ScreenTitle eyebrow="Last touches" title={`Two quick ones for ${q.name}'s song`} subtitle={`A couple more details make it unmistakably ${q.name}. A few words each is plenty.`} />
          {q.boosterList.map((b) => (
            <Field key={b.key} label={b.starter}>
              <TextInput value={q.s.boosters[b.key] ?? ""} onChange={(e) => q.setBooster(b.key, e.target.value)} placeholder={b.placeholder} maxLength={300} />
            </Field>
          ))}
          {more ? (
            openFields
          ) : (
            <Button variant="text" onClick={() => setMore(true)}>
              + A line for the chorus, or anything else
            </Button>
          )}
          <Tip>{KEYBOARD_TIP}</Tip>
        </>
      ),
      footer: (
        <Button block onClick={() => { track("quiz:boosters", { filled: Object.values(q.s.boosters).filter((v) => v.trim()).length, stillThin: q.stillThin }); q.next(); }}>
          {empty ? "Skip for now" : "Continue"}
        </Button>
      ),
    };
  }
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Last touches · optional" title={`Anything else for ${q.name}'s song?`} subtitle="Know exactly what you want to say? Put it here. Not sure? Just continue." />
        {openFields}
        <Tip>{KEYBOARD_TIP}</Tip>
      </>
    ),
    footer: (
      <Button block onClick={q.next}>
        {empty ? "Skip for now" : "Continue"}
      </Button>
    ),
  };
}

/** Read back and confirm: every line we'll write from, in their words. All kept by default. */
export function ReadBackScreen(q: Quiz): ScreenParts {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const kept = q.beats.filter((b) => !b.gone).length;
  const hasStory = kept > 0 || q.s.oneLine.trim().length >= 10;
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Before we write" title={`Here's what we heard about ${q.name}`} subtitle="Every line goes into the song. Fix anything that's off." />
        {q.beats.length === 0 ? (
          <Card tone="muted">
            <Note>You skipped the story questions. Go back and tap an answer or two, or add something in “Anything else”.</Note>
          </Card>
        ) : (
          <div className="ui-beats">
            {q.beats.map((b) => (
              <div key={b.key} className={`ui-beat ${b.gone ? "ui-beat--gone" : ""}`}>
                {editing === b.key ? (
                  <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus style={{ minHeight: 90, fontFamily: "var(--font-display)" }} aria-label={`Edit: ${b.topic}`} />
                ) : (
                  <p className="ui-beat__text">{b.text}</p>
                )}
                <span className="ui-beat__src">
                  {b.emoji} {b.topic}
                  {b.edited ? " · edited by you" : ""}
                </span>
                <div className="ui-beat__actions">
                  {editing === b.key ? (
                    <>
                      <Chip selected onClick={() => { q.editBeat(b.key, draft.trim() || b.original); setEditing(null); track("quiz:beat_edited", { beat: b.key }); }}>
                        Save
                      </Chip>
                      <Chip onClick={() => setEditing(null)}>Cancel</Chip>
                    </>
                  ) : (
                    <>
                      <Chip onClick={() => { setEditing(b.key); setDraft(b.text); }}>✏️ Fix</Chip>
                      <Chip onClick={() => { q.toggleBeat(b.key); track("quiz:beat_toggled", { beat: b.key, gone: !b.gone }); }}>{b.gone ? "↩ Put back" : "✕ Leave out"}</Chip>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {q.s.oneLine.trim() && (
          <Card tone="muted">
            <span className="ui-beat__src">💛 The heart of the song</span>
            <p className="ui-beat__text">{q.s.oneLine.trim()}</p>
          </Card>
        )}
      </>
    ),
    footer: (
      <>
        <Button block disabled={!hasStory || editing !== null} onClick={q.next}>
          Yes, that&apos;s our story
        </Button>
        <p className="ui-footer__note">{hasStory ? `${kept} line${kept === 1 ? "" : "s"} going into ${q.name}'s song` : "Add at least one detail to continue"}</p>
      </>
    ),
  };
}

export function FeelingScreen(q: Quiz): ScreenParts {
  const feelings = feelingsFor(q.group, q.gentle);
  const [showLeaveOut, setShowLeaveOut] = useState(!!q.s.leaveOut);
  const label = q.strength >= 4 ? "Strong story" : q.strength >= 2 ? "Good story" : "A good start";
  const details = q.ingredients.length + (q.s.oneLine.trim() ? 1 : 0);
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
  const details = q.ingredients.length + (q.s.oneLine.trim() ? 1 : 0);
  return {
    body: (
      <>
        <ScreenTitle eyebrow="Almost there" title={`${q.name}'s song is ready to write`} />
        <MascotLoop className="ui-mini-mascot" src="/brand/loops/hero.mp4" poster="/brand/loops/hero.webp" />
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
        <Turnstile siteKey={q.turnstileSiteKey} onToken={q.setTurnstileToken} onError={q.setError} resetKey={q.turnstileReset} />
        <Button block disabled={!emailOk || q.busy || (!!q.turnstileSiteKey && !q.turnstileToken)} onClick={q.submit}>
          {q.busy ? "Starting…" : q.turnstileSiteKey && !q.turnstileToken ? "One moment…" : `Write ${q.name}'s song`}
        </Button>
        <TrustRow items={["Free preview", "No card needed", "Change any line later"]} />
      </>
    ),
  };
}

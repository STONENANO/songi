"use client";
/**
 * Shared UI pieces. Presentation only: no data fetching, no quiz logic.
 * Every screen is built from these, so restyling one restyles the product.
 * Styles: ./ui.css (tokens from app/theme.css).
 */
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { BRAND } from "@/lib/brand";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------------------------------- layout ---------------------------------- */

export type Chapter = { label: string; progress: number /* 0..1 */ };

export function Screen(props: {
  onBack?: () => void;
  chapters?: Chapter[];
  activeChapter?: number;
  footer?: ReactNode;
  children: ReactNode;
  /** Changing this replays the enter animation (use the step id). */
  animKey?: string | number;
}) {
  // The floating bar can grow (docked suggestions); pad the page by its real height so nothing hides behind it.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const foot = root?.querySelector<HTMLElement>(".ui-footer");
    const body = root?.querySelector<HTMLElement>(".ui-screen__body");
    if (!foot || !body || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => body.style.setProperty("padding-bottom", `${foot.offsetHeight + 24}px`));
    ro.observe(foot);
    return () => ro.disconnect();
  }, [props.footer]);
  return (
    <div className="ui-screen" ref={rootRef}>
      <header className="ui-screen__header">
        <div className="ui-screen__bar">
          {props.onBack ? (
            <button type="button" className="ui-screen__back" onClick={props.onBack} aria-label="Back">
              ← Back
            </button>
          ) : (
            <span className="ui-screen__spacer" />
          )}
          <span className="ui-screen__brand">{BRAND.name}</span>
          <span className="ui-screen__spacer" />
        </div>
        {props.chapters && <ChapterProgress chapters={props.chapters} active={props.activeChapter ?? 0} />}
      </header>
      <main className="ui-screen__body ui-enter" key={props.animKey}>
        {props.children}
      </main>
      {props.footer && <StickyFooter>{props.footer}</StickyFooter>}
    </div>
  );
}

export function ScreenTitle({ eyebrow, title, subtitle }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      {eyebrow && <p className="ui-screen__eyebrow">{eyebrow}</p>}
      <h1 className="ui-screen__title">{title}</h1>
      {subtitle ? <p className="ui-screen__subtitle">{subtitle}</p> : <div className="ui-mb" />}
    </>
  );
}

export function ChapterProgress({ chapters, active }: { chapters: Chapter[]; active: number }) {
  return (
    <div className="ui-chapters" role="progressbar" aria-label="Progress">
      {chapters.map((c, i) => (
        <div key={c.label} className={cx("ui-chapter", i === active && "ui-chapter--active")}>
          <div className="ui-chapter__label">{c.label}</div>
          <div className="ui-chapter__track">
            <div className="ui-chapter__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, c.progress)) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StickyFooter({ children }: { children: ReactNode }) {
  return (
    <div className="ui-footer">
      <div className="ui-footer__inner">{children}</div>
    </div>
  );
}

/* --------------------------------- controls --------------------------------- */

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "text";
  disabled?: boolean;
  block?: boolean;
  type?: "button" | "submit";
  href?: string;
  download?: boolean;
}) {
  const className = cx("ui-btn", `ui-btn--${props.variant ?? "primary"}`, props.block && "ui-btn--block");
  if (props.href) {
    return (
      <a className={className} href={props.href} download={props.download}>
        {props.children}
      </a>
    );
  }
  return (
    <button type={props.type ?? "button"} className={className} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

export function Tiles({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={cx("ui-tiles", columns === 3 && "ui-tiles--3")}>{children}</div>;
}

export function Tile(props: { emoji?: string; label: ReactNode; sub?: ReactNode; selected?: boolean; multi?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx("ui-tile", props.selected && "ui-tile--on")} onClick={props.onClick} aria-pressed={!!props.selected}>
      {props.emoji && <span className="ui-tile__emoji" aria-hidden>{props.emoji}</span>}
      <span className="ui-tile__text">
        <span className="ui-tile__label">{props.label}</span>
        {props.sub && <span className="ui-tile__sub">{props.sub}</span>}
      </span>
      {props.multi && <span className="ui-tile__check" aria-hidden>{props.selected ? "✓" : ""}</span>}
    </button>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className="ui-chips">{children}</div>;
}

export function Chip(props: { children: ReactNode; selected?: boolean; ghost?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx("ui-chip", props.selected && "ui-chip--on", props.ghost && "ui-chip--ghost")} onClick={props.onClick} aria-pressed={props.selected}>
      {props.children}
    </button>
  );
}

export function Field(props: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="ui-field">
      {props.label && <span className="ui-field__label">{props.label}</span>}
      {props.children}
      {props.hint && <span className="ui-field__hint">{props.hint}</span>}
      {props.error && <span className="ui-field__error">{props.error}</span>}
    </label>
  );
}

export function TextInput({ hero, className, ...rest }: ComponentProps<"input"> & { hero?: boolean }) {
  return <input {...rest} className={cx("ui-input", hero && "ui-input--hero", className)} />;
}

export function TextArea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea {...rest} className={cx("ui-textarea", className)} />;
}

/* --------------------------------- content ---------------------------------- */

export function Card(props: { title?: ReactNode; tone?: "default" | "muted" | "dark"; children: ReactNode }) {
  return (
    <section className={cx("ui-card", props.tone === "muted" && "ui-card--muted", props.tone === "dark" && "ui-card--dark")}>
      {props.title && <h2 className="ui-card__title">{props.title}</h2>}
      {props.children}
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="ui-note">{children}</p>;
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="ui-tip">
      <span aria-hidden>✎</span>
      <span>{children}</span>
    </p>
  );
}

export function Banner({ children }: { children: ReactNode }) {
  return <div className="ui-banner">{children}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="ui-error" role="alert">{children}</p>;
}

export function TrustRow({ items }: { items: string[] }) {
  return (
    <div className="ui-trust">
      {items.map((t) => (
        <span key={t} className="ui-trust__item">
          <span aria-hidden>✓</span> {t}
        </span>
      ))}
    </div>
  );
}

export function Checklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ui-checklist">
      {items.map((t, i) => (
        <li key={i} className="ui-checklist__item">
          <span className="ui-checklist__icon" aria-hidden>✓</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** A reply from "us" in the story interview. `typing` shows the dots. */
export function Bubble({ children, typing }: { children?: ReactNode; typing?: boolean }) {
  return (
    <div className="ui-bubble" aria-live="polite">
      <span className="ui-bubble__avatar" aria-hidden>♪</span>
      <div className="ui-bubble__body">
        {typing ? (
          <span className="ui-typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function StrengthMeter({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <span className="ui-strength">
      <span className="ui-strength__dots">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={cx("ui-strength__dot", i < level && "ui-strength__dot--on")} />
        ))}
      </span>
    </span>
  );
}

export function IngredientsTray({ items, strength, label = "Song ingredients" }: { items: string[]; strength: number; label?: string }) {
  if (!items.length) return null;
  return (
    <div className="ui-tray">
      <div className="ui-tray__head">
        <span>{label}</span>
        <StrengthMeter level={strength} />
      </div>
      <div className="ui-tray__items">
        {items.map((t) => (
          <span key={t} className="ui-tray__item">{t}</span>
        ))}
      </div>
    </div>
  );
}

export function DetailToLyric({ from, to, animate }: { from: string; to: string; animate?: boolean }) {
  return (
    <div className={cx("ui-example", animate && "ui-example--animate")}>
      <span className="ui-example__from">“{from}”</span>
      <span className="ui-example__arrow">↓ becomes</span>
      <span className="ui-example__to">♪ {to}</span>
    </div>
  );
}

export type StageState = "todo" | "active" | "done";
export function Stages({ items }: { items: { label: ReactNode; state: StageState }[] }) {
  return (
    <ol className="ui-stages">
      {items.map((s, i) => (
        <li key={i} className={cx("ui-stage", s.state === "active" && "ui-stage--active", s.state === "done" && "ui-stage--done")}>
          <span className="ui-stage__icon" aria-hidden>{s.state === "done" ? "✓" : ""}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: ReactNode }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="ui-progress">
      <div className="ui-progress__row">
        <span className="ui-progress__label">{label}</span>
        <span className="ui-progress__pct">{pct}%</span>
      </div>
      <div className="ui-progress__track">
        <div className="ui-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Shows its content, then folds away after `ms` (or straight away when `closed`). */
export function Collapse({ ms, closed, children }: { ms?: number; closed?: boolean; children: ReactNode }) {
  const [shut, setShut] = useState(!!closed);
  useEffect(() => {
    if (closed || !ms) return;
    const t = setTimeout(() => setShut(true), ms);
    return () => clearTimeout(t);
  }, [ms, closed]);
  return (
    <div className={cx("ui-collapse", (shut || closed) && "ui-collapse--closed")} aria-hidden={shut || closed}>
      <div>{children}</div>
    </div>
  );
}

/**
 * The chosen tile, shrunk to one line with "Change". Used once a choice is made so the
 * next thing to fill in moves up, above the fold.
 */
export function Picked({ emoji, label, sub, onChange }: { emoji?: string; label: ReactNode; sub?: ReactNode; onChange: () => void }) {
  return (
    <button type="button" className="ui-picked" onClick={onChange} aria-label="Change your answer">
      {emoji && <span className="ui-tile__emoji" aria-hidden>{emoji}</span>}
      <span className="ui-tile__text">
        <span className="ui-tile__label">{label}</span>
        {sub && <span className="ui-tile__sub">{sub}</span>}
      </span>
      <span className="ui-picked__change">Change</span>
    </button>
  );
}

/**
 * Scroll so `el` sits above the floating bar (the bar covers the bottom of the screen).
 * Use when focus moves to something that may be behind it.
 */
export function revealAboveBar(el: Element | null) {
  if (!el || typeof window === "undefined") return;
  const bar = document.querySelector(".ui-footer")?.getBoundingClientRect().top ?? window.innerHeight;
  const r = el.getBoundingClientRect();
  if (r.bottom > bar - 12) window.scrollBy({ top: r.bottom - bar + 24, behavior: "smooth" });
  else if (r.top < 70) window.scrollBy({ top: r.top - 90, behavior: "smooth" });
}

/** A previous answer shown small, so the next question stays above the fold. */
export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="ui-quote">{children}</blockquote>;
}

export type RecapRow = { label: string; value: ReactNode; onEdit?: () => void };
/** A short summary of what the buyer chose, each line editable. */
export function Recap({ rows }: { rows: RecapRow[] }) {
  return (
    <div className="ui-recap">
      {rows.map((r) => (
        <div key={r.label} className="ui-recap__row">
          <span className="ui-recap__label">{r.label}</span>
          <span className="ui-recap__value">{r.value}</span>
          {r.onEdit ? (
            <button type="button" className="ui-recap__edit" onClick={r.onEdit}>
              Edit
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- lyrics ---------------------------------- */

export type LyricSection = { tag: string; lines: { text: string; source?: string }[] };

/**
 * Lyrics with lines built from the buyer's story highlighted. Tapping a
 * highlighted line shows which detail it came from.
 */
export function Lyrics({ sections, reveal, legend }: { sections: LyricSection[]; reveal?: boolean; legend?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  let n = 0;
  return (
    <div className="ui-lyrics">
      {legend && (
        <p className="ui-lyrics__legend">
          <span className="ui-lyrics__swatch" aria-hidden /> {legend}
        </p>
      )}
      {sections.map((s, si) => (
        <div key={si} className="ui-lyrics__section">
          <div className="ui-lyrics__tag">{s.tag}</div>
          {s.lines.map((l, li) => {
            const id = `${si}-${li}`;
            const delay = reveal ? { animationDelay: `${n++ * 0.12}s` } : undefined;
            if (!l.source) {
              return (
                <span key={id} className={cx("ui-lyrics__line", reveal && "ui-lyrics__line--reveal")} style={delay}>
                  {l.text}
                </span>
              );
            }
            return (
              <span key={id}>
                <button
                  type="button"
                  className={cx("ui-lyrics__line", "ui-lyrics__line--story", reveal && "ui-lyrics__line--reveal")}
                  style={delay}
                  onClick={() => setOpen(open === id ? null : id)}
                  aria-expanded={open === id}
                >
                  {l.text}
                </button>
                {open === id && <span className="ui-lyrics__source">From your story: “{l.source}”</span>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- audio ----------------------------------- */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Big-button player with a waveform-style scrubber. Pauses other players when it starts. */
export function AudioPlayer({ src, title, seed = 1, onPlay, onEnded }: { src: string; title?: ReactNode; seed?: number; onPlay?: () => void; onEnded?: () => void }) {
  const cb = useRef({ onPlay, onEnded });
  cb.current = { onPlay, onEnded };
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const bars = useMemo(() => {
    let x = seed * 9301 + 49297;
    return Array.from({ length: 40 }, (_, i) => {
      x = (x * 9301 + 49297) % 233280;
      return 0.3 + 0.7 * Math.abs(Math.sin(i / 3 + x / 233280));
    });
  }, [seed]);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const onTime = () => setT(a.currentTime);
    const onMeta = () => setD(a.duration || 0);
    const onEnd = () => {
      setPlaying(false);
      cb.current.onEnded?.();
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => {
      setPlaying(true);
      cb.current.onPlay?.();
      document.querySelectorAll("audio").forEach((other) => other !== a && other.pause());
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", onPause);
    a.addEventListener("play", onPlay);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("play", onPlay);
    };
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !d) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * d;
  };
  const played = d ? t / d : 0;

  return (
    <div className="ui-player">
      <audio ref={ref} src={src} preload="metadata" />
      <button type="button" className="ui-player__btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="ui-player__main">
        {title && <div className="ui-player__title">{title}</div>}
        <div className="ui-player__bars" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)} tabIndex={0}>
          {bars.map((h, i) => (
            <span key={i} className={cx("ui-player__bar", i / bars.length < played && "ui-player__bar--played")} style={{ height: `${h * 100}%` }} />
          ))}
        </div>
        <div className="ui-player__time">
          <span>{fmt(t)}</span>
          <span>{d ? fmt(d) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- wait visuals -------------------------------- */

/** Shown on the wait page when no video is configured. Cycles through messages. */
export function StudioCard({ messages, sub }: { messages: string[]; sub?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % messages.length), 4500);
    return () => clearInterval(t);
  }, [messages.length]);
  return (
    <div className="ui-studio">
      <span className="ui-studio__rec" aria-hidden>REC</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="ui-studio__tape" src="/brand/mascot/headphones.webp" alt="" aria-hidden />
      <span className="ui-studio__tears" aria-hidden><i /><i /><i /><i /></span>
      <div className="ui-studio__eq" aria-hidden>
        {Array.from({ length: 9 }, (_, k) => (
          <span key={k} style={{ animationDelay: `${(k % 5) * 0.13}s` }} />
        ))}
      </div>
      <p className="ui-studio__msg" key={i}>{messages[i] ?? ""}</p>
      {sub && <p className="ui-studio__sub">{sub}</p>}
    </div>
  );
}

/** Autoplays muted (browsers block sound until a tap), with a one-tap unmute. */
export function WaitVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  return (
    <div className="ui-stack">
      <video ref={ref} className="ui-video" src={src} autoPlay muted={muted} playsInline loop />
      {muted && (
        <Button variant="secondary" onClick={() => { setMuted(false); void ref.current?.play(); }}>
          🔊 Tap for sound
        </Button>
      )}
    </div>
  );
}

/* ------------------------------- mascot loop -------------------------------- */

/**
 * A short looping mascot clip that stands in for a still image (home page, quiz). Muted and
 * inline so phones autoplay it. The still (the clip's first frame) shows first, stays if the
 * video can't play, and is all that shows when the viewer prefers reduced motion. `ui-loop`
 * fades the clip's backdrop into the page with a round mask.
 */
export function MascotLoop({ src, poster, className }: { src: string; poster: string; className?: string }) {
  const [still, setStill] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  if (still || failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cx(className, "ui-loop")} src={poster} alt="" aria-hidden />;
  }
  return <video className={cx(className, "ui-loop")} src={src} poster={poster} autoPlay muted loop playsInline preload="metadata" onError={() => setFailed(true)} aria-hidden />;
}

/* ------------------------------ mascot stage -------------------------------- */

/** The mascot's looping clips, one per step of making a song. Files live in /public/brand/wait. */
export const MASCOT_CLIPS = ["writing", "music", "vocals", "name", "mixing", "checking"] as const;
export type MascotClip = (typeof MASCOT_CLIPS)[number];

/**
 * The wait-screen mascot. Plays the clip for the current step and crossfades when the step
 * changes. Only the current and outgoing clips are mounted, so the page loads one small video
 * at a time. The poster frame shows straight away, stays if a video can't play, and is all
 * that shows when the viewer prefers reduced motion. `label` is the status line in the bubble.
 */
export function MascotStage({ clip, label, rec }: { clip: MascotClip; label?: ReactNode; rec?: boolean }) {
  const [layers, setLayers] = useState<{ clip: MascotClip; key: number }[]>([{ clip, key: 0 }]);
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    setLayers((ls) => (ls[ls.length - 1].clip === clip ? ls : [...ls.slice(-1), { clip, key: ls[ls.length - 1].key + 1 }]));
  }, [clip]);
  // Drop the outgoing clip once the crossfade is done.
  useEffect(() => {
    if (layers.length < 2) return;
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 700);
    return () => clearTimeout(t);
  }, [layers]);
  return (
    <div className="ui-mascot">
      {rec && <span className="ui-mascot__rec" aria-hidden>REC</span>}
      {layers.map((l, i) => (
        <MascotLayer key={l.key} clip={l.clip} still={still} leaving={i < layers.length - 1} />
      ))}
      {label && (
        <p className="ui-mascot__bubble" key={String(label)} aria-live="polite">
          {label}
        </p>
      )}
    </div>
  );
}

function MascotLayer({ clip, still, leaving }: { clip: MascotClip; still: boolean; leaving: boolean }) {
  const [failed, setFailed] = useState(false);
  const poster = `/brand/wait/${clip}.webp`;
  return (
    <div className={cx("ui-mascot__layer", leaving && "ui-mascot__layer--leaving")}>
      {still || failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" />
      ) : (
        <video src={`/brand/wait/${clip}.mp4`} poster={poster} autoPlay muted loop playsInline preload="auto" onError={() => setFailed(true)} aria-hidden />
      )}
    </div>
  );
}

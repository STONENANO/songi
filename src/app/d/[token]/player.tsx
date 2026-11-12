"use client";
/**
 * The song's permanent home. No cover art: the lyrics are the picture. The line being
 * sung is bright and the lines around it fade with distance; the title and controls sit
 * below. Styling is in player.css and reads theme tokens (--player-*), so it re-skins.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimedSection } from "@/lib/onboarding/lyrics-view";
import "./player.css";

export type PlayerProps = {
  title: string;
  byline: string;
  src: string;
  downloadHref: string;
  sections: TimedSection[];
  welcome: boolean;
  recipient: string;
  /** Known length in seconds, so the time shows before the audio loads. */
  durationS?: number | null;
};

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export default function SongPlayer({ title, byline, src, downloadHref, sections, welcome, recipient, durationS }: PlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(durationS ?? 0);
  const [copied, setCopied] = useState(false);
  const [showWelcome, setShowWelcome] = useState(welcome);

  // One flat list of lines (section tags dropped: the song's shape is felt, not labelled).
  const lines = useMemo(() => sections.flatMap((s) => s.lines), [sections]);
  const timed = lines.some((l) => l.start !== null);
  const active = useMemo(() => {
    if (!timed) return -1;
    let idx = -1;
    lines.forEach((l, i) => {
      if (l.start !== null && l.start <= t + 0.3) idx = i;
    });
    return idx;
  }, [lines, t, timed]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const on: [string, () => void][] = [
      ["timeupdate", () => setT(a.currentTime)],
      ["loadedmetadata", () => a.duration && setD(a.duration)],
      ["durationchange", () => a.duration && setD(a.duration)],
      ["play", () => setPlaying(true)],
      ["pause", () => setPlaying(false)],
      ["ended", () => setPlaying(false)],
    ];
    on.forEach(([e, f]) => a.addEventListener(e, f));
    // timeupdate fires ~4x a second; a frame loop keeps the lyric highlight in step while playing.
    let raf = 0;
    const tick = () => {
      if (!a.paused) setT(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      on.forEach(([e, f]) => a.removeEventListener(e, f));
      cancelAnimationFrame(raf);
    };
  }, []);

  // Lock screen and headphone controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: byline });
  }, [title, byline]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);
  const seekTo = useCallback((s: number, play = false) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(s, a.duration || s));
    setT(a.currentTime);
    if (play && a.paused) void a.play();
  }, []);

  const share = async () => {
    const url = window.location.href.split("?")[0];
    if (navigator.share) {
      await navigator.share({ title, text: `A song for ${recipient}`, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="pl">
      <audio ref={audio} src={src} preload="metadata" />

      <header className="pl-top">
        <button type="button" className="pl-icon" onClick={() => void share()} aria-label="Share this song">
          <ShareIcon />
        </button>
        <span className="pl-top__label">{copied ? "Link copied" : `A song for ${recipient}`}</span>
        <a className="pl-icon" href={downloadHref} download aria-label="Download MP3" title="Download MP3">
          <DownloadIcon />
        </a>
      </header>

      {showWelcome && (
        <div className="pl-welcome" role="status">
          <span>
            <strong>It&apos;s yours.</strong> Receipt sent to your email.
          </span>
          <button type="button" className="pl-chip" onClick={() => void share()}>
            Share
          </button>
          <button type="button" className="pl-icon pl-icon--sm" onClick={() => setShowWelcome(false)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {lines.length > 0 ? <LyricStage lines={lines} active={active} timed={timed} compact={showWelcome} onSeek={(s) => seekTo(s, true)} /> : <div className="pl-stage pl-stage--empty" aria-hidden>♪</div>}

      <div className="pl-meta">
        <h1 className="pl-title">{title}</h1>
        <p className="pl-byline">{byline}</p>
      </div>

      <div className="pl-controls">
        <input
          className="pl-scrub"
          type="range"
          min={0}
          max={d || 0}
          step={0.1}
          value={Math.min(t, d || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="Seek"
          style={{ ["--pl-progress" as string]: `${d ? (t / d) * 100 : 0}%` }}
        />
        <div className="pl-times">
          <span>{fmt(t)}</span>
          <span>-{fmt(d - t)}</span>
        </div>
        <div className="pl-buttons">
          <button type="button" className="pl-icon pl-icon--lg" onClick={() => seekTo(t - 10)} aria-label="Back 10 seconds">
            <SkipIcon back />
          </button>
          <button type="button" className="pl-play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="pl-icon pl-icon--lg" onClick={() => seekTo(t + 10)} aria-label="Forward 10 seconds">
            <SkipIcon />
          </button>
        </div>
      </div>

      <p className="pl-foot">Bookmark this page or save the link. It always plays and downloads {recipient}&apos;s song.</p>
    </div>
  );
}

type Line = TimedSection["lines"][number];

/**
 * The lyrics as the centrepiece. The sung line sits in the middle at full strength and
 * every other line fades with its distance from it. Scrolling by hand shows all lines
 * clearly for a few seconds, then it follows the song again. Tap a line to jump there.
 */
function LyricStage({ lines, active, timed, compact, onSeek }: { lines: Line[]; active: number; timed: boolean; compact: boolean; onSeek: (s: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLElement | null)[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const browseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Before the first sung line, focus the first one so the stage opens on the song's start.
  const focus = Math.max(0, active);

  useEffect(() => {
    const el = lineEls.current[focus];
    const c = box.current;
    if (!el || !c || browsing) return;
    c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [focus, browsing]);

  const userScrolled = () => {
    setBrowsing(true);
    if (browseTimer.current) clearTimeout(browseTimer.current);
    browseTimer.current = setTimeout(() => setBrowsing(false), 3500);
  };

  // Strength by distance from the sung line: 1, .5, .3, .18, then a faint floor.
  const strength = (i: number) => {
    if (!timed) return 0.9;
    if (browsing) return i === active ? 1 : 0.7;
    const dist = Math.abs(i - focus);
    return [1, 0.5, 0.3, 0.18][dist] ?? 0.1;
  };

  return (
    <section className={`pl-stage${compact ? " pl-stage--compact" : ""}${timed ? "" : " pl-stage--still"}`} aria-label="Lyrics">
      <div className="pl-stage__scroll" ref={box} onWheel={userScrolled} onTouchMove={userScrolled}>
        <div className="pl-stage__pad" />
        {lines.map((l, i) => {
          const cls = `pl-line${i === active ? " is-active" : ""}${l.source ? " is-story" : ""}`;
          const style = { opacity: strength(i) };
          return timed && l.start !== null ? (
            <button key={i} type="button" ref={(el) => void (lineEls.current[i] = el)} className={cls} style={style} onClick={() => onSeek(l.start!)}>
              <span>{l.text}</span>
            </button>
          ) : (
            <p key={i} ref={(el) => void (lineEls.current[i] = el)} className={cls} style={style}>
              <span>{l.text}</span>
            </p>
          );
        })}
        <div className="pl-stage__pad" />
      </div>
    </section>
  );
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" fill="currentColor" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
    <rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
  </svg>
);
const SkipIcon = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={back ? undefined : { transform: "scaleX(-1)" }}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fill="currentColor" stroke="none" fontFamily="system-ui" style={back ? undefined : { transform: "scaleX(-1)", transformOrigin: "12px 12px" }}>
      10
    </text>
  </svg>
);

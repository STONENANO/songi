"use client";
/**
 * The objects floating around the hero. Each drifts on its own loop and leans gently
 * toward the pointer, so the page feels alive without anything moving fast.
 */
import { useEffect, useRef } from "react";

const OBJECTS = [
  { src: "cassette", cls: "home-float--cassette", depth: 18 },
  { src: "polaroid", cls: "home-float--polaroid", depth: 12 },
  { src: "envelope", cls: "home-float--envelope", depth: 22 },
  { src: "tissues", cls: "home-float--tissues", depth: 10 },
];

export function Floaters() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--px", String(e.clientX / window.innerWidth - 0.5));
        el.style.setProperty("--py", String(e.clientY / window.innerHeight - 0.5));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div className="home-floaters" ref={ref} aria-hidden>
      {OBJECTS.map((o, i) => (
        <span key={o.src} className={`home-float ${o.cls}`} style={{ ["--d" as string]: o.depth, animationDelay: `${i * 0.12}s` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/brand/objects/${o.src}.webp`} alt="" />
        </span>
      ))}
    </div>
  );
}

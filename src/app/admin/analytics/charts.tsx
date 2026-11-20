"use client";

/**
 * Charts for /admin/analytics: plain SVG, no chart library. Marks follow the dataviz spec
 * (2px lines, 4px rounded bar ends, hairline grid, one axis), every chart has a hover and
 * keyboard tooltip, and every value is also in a table or label on the page.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export type Series = { name: string; color: string; values: (number | null)[] };
type TipRow = { name: string; color: string; value: string };
type Tip = { x: number; y: number; title: string; rows: TipRow[] } | null;

export function Tooltip({ tip, hostWidth }: { tip: Tip; hostWidth: number }) {
  if (!tip) return null;
  const flip = tip.x > hostWidth - 170;
  return (
    <div className="tip" role="status" style={{ left: flip ? undefined : tip.x + 14, right: flip ? hostWidth - tip.x + 14 : undefined, top: tip.y, transform: "translateY(-50%)" }}>
      <div className="t">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="r" key={r.name}>
          <span>
            <i style={{ background: r.color }} />
            {r.name}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

/** Axis top and step on clean numbers (1, 2, 2.5, 5 × 10^k), about four gridlines. */
export function niceScale(v: number): { max: number; step: number } {
  if (!(v > 0)) return { max: 1, step: 0.25 };
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw) ?? 10 * p;
  return { max: step * Math.ceil(v / step - 1e-9), step };
}

export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const W = 160;
  const H = 34;
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return null;
  const vs = pts.map((p) => p[1]);
  const lo = Math.min(...vs);
  const span = Math.max(...vs) - lo || 1;
  const n = values.length - 1 || 1;
  const xy = pts.map(([i, v]) => [(i / n) * W, H - 4 - ((v - lo) / span) * (H - 10)]);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${xy[xy.length - 1][0]} ${H} L${xy[0][0]} ${H} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** One axis, any number of series in the same unit. Null = not counted that day (a gap). */
export function LineChart({ labels, series, format, axisFormat, label }: { labels: string[]; series: Series[]; format: (v: number) => string; axisFormat: (v: number) => string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const [focus, setFocus] = useState<number | null>(null);
  // Draw at the chart's real width, so axis text stays 11px on a phone instead of shrinking.
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 420 ? 200 : 230;
  const L = 46;
  const R = 14;
  const T = 10;
  const B = 26;
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const { max, step } = niceScale(Math.max(...all, 0) * 1.05);
  const lowest = Math.min(0, ...all);
  const min = lowest < 0 ? -step * Math.ceil(-lowest / step) : 0;
  const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 78))));

  const show = (i: number) => {
    const svg = svgRef.current;
    const h = host.current;
    if (!svg || !h) return;
    const sr = svg.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    const sx = sr.width / W;
    setFocus(i);
    setTip({
      x: sr.left - hr.left + x(i) * sx,
      y: sr.top - hr.top + ((T + H - B) / 2) * sx,
      title: labels[i],
      rows: series.map((s) => ({ name: s.name, color: s.color, value: s.values[i] == null ? "not counted" : format(s.values[i] as number) })),
    });
  };
  const hide = () => {
    setFocus(null);
    setTip(null);
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const sr = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - sr.left) / sr.width) * W;
    show(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1 || 1)))));
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    const cur = focus ?? n - 1;
    if (e.key === "ArrowLeft") show(Math.max(0, cur - 1));
    else if (e.key === "ArrowRight") show(Math.min(n - 1, cur + 1));
    else return;
    e.preventDefault();
  };

  return (
    <div className="chart" ref={host}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={Math.abs(v) < 1e-9 && min < 0 ? "var(--color-border-strong)" : "var(--an-grid)"} strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end">
              {axisFormat(v)}
            </text>
          </g>
        ))}
        {labels.map((d, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={d + i} x={x(i)} y={H - 6} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}>
              {d}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : ([x(i), y(v)] as const)));
          let d = "";
          let pen = false;
          for (const p of pts) {
            if (!p) {
              pen = false;
              continue;
            }
            d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
            pen = true;
          }
          const valid = pts.filter((p): p is readonly [number, number] => !!p);
          const last = valid[valid.length - 1];
          return (
            <g key={s.name}>
              {series.length === 1 && valid.length > 1 && <path d={`${d}L${last[0]} ${y(Math.max(0, min))} L${valid[0][0]} ${y(Math.max(0, min))} Z`} fill={s.color} opacity={0.1} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {(n <= 4 ? valid : last ? [last] : []).map((p, k) => (
                <circle key={k} cx={p[0]} cy={p[1]} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
              ))}
            </g>
          );
        })}
        {focus != null && <line x1={x(focus)} x2={x(focus)} y1={T} y2={H - B} stroke="var(--color-border-strong)" strokeWidth={1} />}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" tabIndex={0} aria-label={`${label}. Use the arrow keys to read each day.`} onPointerMove={onMove} onPointerLeave={hide} onFocus={() => show(focus ?? n - 1)} onBlur={hide} onKeyDown={onKey} />
      </svg>
      <Tooltip tip={tip} hostWidth={host.current?.offsetWidth ?? 600} />
    </div>
  );
}

export type FunnelStep = { name: string; value: number; color: string };

/** Three bars on one scale (share of visitors), with the step-to-step conversion between them. */
export function Funnel({ steps, fmt, pct }: { steps: FunnelStep[]; fmt: (n: number) => string; pct: (r: number | null) => string }) {
  const host = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const top = steps[0]?.value ?? 0;
  const show = (el: HTMLElement, s: FunnelStep) => {
    const r = el.getBoundingClientRect();
    const hr = host.current!.getBoundingClientRect();
    setTip({ x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, title: s.name, rows: [{ name: "People", color: s.color, value: fmt(s.value) }, { name: "Of visitors", color: "transparent", value: pct(top ? s.value / top : null) }] });
  };
  return (
    <div className="chart" ref={host}>
      <div className="funnel">
        {steps.map((s, i) => {
          const next = steps[i + 1];
          return (
            <div className="fstep" key={s.name}>
              <div className="fl">{s.name}</div>
              <div className="fv">{fmt(s.value)}</div>
              <div className="fp">{i === 0 ? "100% of visitors" : `${pct(top ? s.value / top : null)} of visitors`}</div>
              <div
                className="fbar"
                tabIndex={0}
                role="img"
                aria-label={`${s.name}: ${fmt(s.value)}`}
                onPointerEnter={(e) => show(e.currentTarget, s)}
                onPointerLeave={() => setTip(null)}
                onFocus={(e) => show(e.currentTarget, s)}
                onBlur={() => setTip(null)}
              >
                <div className="fill" style={{ background: s.color, height: `${top ? Math.max(s.value ? 1.5 : 0, (s.value / top) * 100) : 0}%` }} />
              </div>
              {next && (
                <div className="fdrop">
                  {pct(s.value ? next.value / s.value : null)} →<small>{fmt(Math.max(0, s.value - next.value))} left</small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} hostWidth={host.current?.offsetWidth ?? 600} />
    </div>
  );
}

/** Horizontal bars, value at the tip. Labels are data (ad names), rendered as text. */
export function HBars({ rows, color, fmt, empty }: { rows: { label: string; sub?: string; value: number }[]; color: string; fmt: (n: number) => string; empty: ReactNode }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label + (r.sub ?? "")} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 54px", gap: "4px 10px", alignItems: "center", margin: "8px 0" }}>
          <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>
            {r.label}
            {r.sub && <span style={{ color: "var(--color-text-faint)" }}>{`  ·  ${r.sub}`}</span>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.value)}</div>
          <div style={{ gridColumn: "1 / -1", height: 12, position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(r.value ? 1.5 : 0.5, (r.value / max) * 100)}%`, background: color, borderRadius: "0 4px 4px 0" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two bars per row (quiz completes, purchases) on one scale, with the buy rate under them. */
export function PairedBars({ rows, colors, pct }: { rows: { label: string; a: number; b: number }[]; colors: [string, string]; pct: (r: number | null) => string }) {
  if (!rows.length) return <div className="empty">No songs in this period.</div>;
  const max = Math.max(...rows.map((r) => r.a), 1);
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "104px minmax(0,1fr)", gap: 8, alignItems: "center", margin: "10px 0" }}>
          <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>{r.label}</div>
          <div style={{ display: "grid", gap: 2 }}>
            {[r.a, r.b].map((v, k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, height: 11 }}>
                <div style={{ height: 10, width: `${Math.max(v ? 1.5 : 0.5, (v / max) * 82)}%`, background: colors[k], borderRadius: "0 4px 4px 0" }} />
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ gridColumn: 2, fontSize: 11, color: "var(--color-text-faint)", marginTop: -1 }}>{`${pct(r.a ? r.b / r.a : null)} buy`}</div>
        </div>
      ))}
    </div>
  );
}

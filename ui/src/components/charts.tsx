/**
 * SVG chart primitives. TSX port of the design bundle's charts.jsx
 * (specs/specship-desktop/charts.jsx) — sparklines, line chart, donut,
 * stacked/horizontal bars, squarified treemap. In-module SVG only, no chart
 * library (REQ-DESKTOP-017.A2).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './icons';

// ---- Sparkline ----
export function Sparkline({ data, color, w = 80, h = 24, fill }: { data: number[]; color?: string; w?: number; h?: number; fill?: boolean }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - ((d - min) / range) * (h - 4) - 2]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0]!.toFixed(1) + ' ' + p[1]!.toFixed(1)).join(' ');
  const area = line + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={area} fill={color} opacity={0.12} />}
      <path d={line} fill="none" stroke={color || 'var(--accent)'} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---- Line chart with hover ----
export interface LinePoint {
  day: number | string;
  cost: number;
  [key: string]: unknown;
}

export function LineChart({ series, w = 640, h = 200, color = 'var(--accent)', xTicks = 6, onHover }: {
  series: LinePoint[]; w?: number; h?: number; color?: string; xTicks?: number; onHover?: (p: LinePoint | null) => void;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const pad = { l: 44, r: 12, t: 14, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const vals = series.map((s) => s.cost);
  const max = Math.max(...vals) * 1.12 || 1;
  const min = 0;
  const x = (i: number) => pad.l + (i / (series.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const line = series.map((s, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.cost).toFixed(1)).join(' ');
  const area = line + ` L${x(series.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
  const yticks = 4;
  const hiPoint = hi != null ? series[hi] : undefined;
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
      onMouseLeave={() => { setHi(null); onHover?.(null); }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * w;
        let idx = Math.round(((px - pad.l) / iw) * (series.length - 1));
        idx = Math.max(0, Math.min(series.length - 1, idx));
        setHi(idx);
        onHover?.(series[idx] ?? null);
      }}
    >
      {Array.from({ length: yticks + 1 }).map((_, i) => {
        const v = (max / yticks) * i;
        const yy = y(v);
        return (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={yy} y2={yy} stroke="rgba(255,255,255,0.05)" />
            <text x={pad.l - 8} y={yy + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-mono)">
              {'$' + v.toFixed(0)}
            </text>
          </g>
        );
      })}
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {series
        .filter((_, i) => i % Math.ceil(series.length / xTicks) === 0)
        .map((s) => {
          const i = series.indexOf(s);
          return (
            <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-mono)">
              {s.day + 'd'}
            </text>
          );
        })}
      {hi != null && hiPoint && (
        <g>
          <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={pad.t + ih} stroke={color} opacity={0.4} strokeDasharray="3 3" />
          <circle cx={x(hi)} cy={y(hiPoint.cost)} r={4} fill={color} stroke="var(--bg-canvas)" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}

// ---- Donut ----
export interface DonutSlice {
  label: string;
  cost: number;
  color: string;
}

export function Donut({ data, size = 140, thickness = 22, centerLabel, centerSub }: {
  data: DonutSlice[]; size?: number; thickness?: number; centerLabel?: string; centerSub?: string;
}) {
  const total = data.reduce((a, b) => a + b.cost, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = d.cost / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} strokeLinecap="butt"
            />
          );
          off += dash;
          return el;
        })}
      </svg>
      {centerLabel && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{centerLabel}</div>
            {centerSub && <div className="muted" style={{ fontSize: 10 }}>{centerSub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Stacked horizontal bars (cost by model per project) ----
export interface StackedSegment {
  key: string;
  label: string;
  color: string;
}

export interface StackedRow {
  label: string;
  values: Record<string, number>;
}

export function StackedBars({ rows, segments, fmt }: { rows: StackedRow[]; segments: StackedSegment[]; fmt?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => segments.reduce((a, s) => a + (r.values[s.key] || 0), 0))) || 1;
  return (
    <div className="col gap-10">
      {rows.map((r) => {
        const total = segments.reduce((a, s) => a + (r.values[s.key] || 0), 0);
        return (
          <div key={r.label} className="row gap-10">
            <div style={{ width: 110, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </div>
            <div className="row" style={{ flex: 1, height: 18, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
              {segments.map((s) => {
                const v = r.values[s.key] || 0;
                return v ? (
                  <div key={s.key} title={`${s.label}: ${fmt ? fmt(v) : v}`} style={{ width: (v / max) * 100 + '%', height: '100%', background: s.color }} />
                ) : null;
              })}
            </div>
            <div className="tabular" style={{ width: 64, fontSize: 12, textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
              {fmt ? fmt(total) : total}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Horizontal mini bars (e.g. tools, node kinds) ----
export interface HBarItem {
  [key: string]: unknown;
}

export function HBars({ items, max, color, fmt, labelKey = 'name', valueKey = 'calls', onItemClick, selectedKey }: {
  items: HBarItem[]; max?: number; color?: string | ((it: HBarItem) => string); fmt?: (v: number) => string;
  labelKey?: string; valueKey?: string; onItemClick?: (it: HBarItem) => void; selectedKey?: string | null;
}) {
  const m = max || Math.max(...items.map((i) => Number(i[valueKey]) || 0)) || 1;
  return (
    <div className="col gap-6">
      {items.map((it) => {
        const label = String(it[labelKey]);
        const value = Number(it[valueKey]) || 0;
        const sel = selectedKey != null && label === selectedKey;
        return (
          <div
            key={label}
            className="row gap-10"
            onClick={onItemClick ? () => onItemClick(it) : undefined}
            style={{ cursor: onItemClick ? 'pointer' : 'default', borderRadius: 5, padding: onItemClick ? '2px 4px' : 0, margin: onItemClick ? '0 -4px' : 0, background: sel ? 'var(--accent-soft)' : 'transparent' }}
            onMouseEnter={onItemClick ? (e) => { if (!sel) e.currentTarget.style.background = 'var(--bg-hover)'; } : undefined}
            onMouseLeave={onItemClick ? (e) => { if (!sel) e.currentTarget.style.background = 'transparent'; } : undefined}
          >
            <div style={{ width: 116, fontSize: 12, fontFamily: 'var(--font-mono)', color: sel ? 'var(--accent)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {label}
            </div>
            <div className="grow" style={{ height: 16, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: (value / m) * 100 + '%', height: '100%', background: typeof color === 'function' ? color(it) : color || 'var(--accent)', borderRadius: 4 }} />
            </div>
            <div className="tabular" style={{ width: 52, textAlign: 'right', fontSize: 12, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
              {fmt ? fmt(value) : value}
            </div>
            {onItemClick && <Icon name="chevronRight" size={12} style={{ color: sel ? 'var(--accent)' : 'var(--text-faint)', flexShrink: 0 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ---- Squarified treemap (Bruls et al.) ----
export interface TreemapItem {
  key: string;
  label: string;
  value: number;
  /** 0..1 — drives the warm color ramp. */
  intensity?: number;
  sub?: string;
  title?: string;
}

interface TreemapCell extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function squarifyLayout(data: TreemapItem[], X: number, Y: number, W: number, H: number): TreemapCell[] {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const items = data.map((d) => ({ d, area: (d.value / total) * (W * H) }));
  const res: TreemapCell[] = [];
  let rect = { x: X, y: Y, w: W, h: H };
  let row: Array<{ d: TreemapItem; area: number }> = [];
  const sum = (arr: typeof row) => arr.reduce((a, b) => a + b.area, 0);
  const worst = (arr: typeof row, len: number) => {
    if (!arr.length) return Infinity;
    const s = sum(arr);
    const mx = Math.max(...arr.map((a) => a.area));
    const mn = Math.min(...arr.map((a) => a.area));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  const flush = () => {
    const len = Math.min(rect.w, rect.h);
    const s = sum(row);
    const thick = s / (len || 1);
    let off = 0;
    const horizontal = rect.w >= rect.h;
    row.forEach((it) => {
      const cl = it.area / (thick || 1);
      if (horizontal) res.push({ ...it.d, x: rect.x, y: rect.y + off, w: thick, h: cl });
      else res.push({ ...it.d, x: rect.x + off, y: rect.y, w: cl, h: thick });
      off += cl;
    });
    if (horizontal) rect = { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h };
    else rect = { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
    row = [];
  };
  items.forEach((it) => {
    const len = Math.min(rect.w, rect.h);
    if (row.length && worst([...row, it], len) > worst(row, len)) flush();
    row.push(it);
  });
  if (row.length) flush();
  return res;
}

export function Treemap({ items, height = 120, onPick, selKey }: {
  items: TreemapItem[]; height?: number; onPick?: (c: TreemapItem) => void; selKey?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => setW(es[0]!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const W = w || 600;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const cells = squarifyLayout(sorted, 0, 0, W, height);
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-canvas)' }}>
      {cells.map((c) => {
        const t = Math.max(0, Math.min(1, c.intensity || 0));
        const warm = t > 0.66 ? 'var(--error)' : t > 0.33 ? 'var(--warn)' : 'var(--node-route)';
        const bg = `color-mix(in srgb, ${warm} ${Math.round(20 + t * 58)}%, var(--bg-elevated))`;
        const on = selKey === c.key;
        const big = c.w > 52 && c.h > 26;
        const mid = c.w > 36 && c.h > 15;
        const cellStyle: CSSProperties = {
          position: 'absolute', left: c.x + 1.5, top: c.y + 1.5, width: Math.max(0, c.w - 3), height: Math.max(0, c.h - 3),
          background: bg, borderRadius: 4, cursor: onPick ? 'pointer' : 'default', overflow: 'hidden',
          padding: big ? '5px 7px' : '0 5px', display: 'flex', flexDirection: 'column',
          justifyContent: big ? 'flex-start' : 'center',
          border: on ? '1.5px solid var(--accent)' : '1px solid rgba(0,0,0,0.26)',
        };
        return (
          <div key={c.key} onClick={onPick ? () => onPick(c) : undefined} title={c.title || c.label} style={cellStyle}>
            {mid && (
              <span className="mono" style={{ fontSize: big ? 10 : 9, fontWeight: 500, color: t > 0.45 ? '#fff' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>
                {c.label}
              </span>
            )}
            {big && c.sub && (
              <span className="mono tabular" style={{ fontSize: 9, color: t > 0.45 ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)', marginTop: 1 }}>
                {c.sub}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

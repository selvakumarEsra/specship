/**
 * Shared UI primitives + state-pill config. TSX port of the design bundle's
 * ui.jsx (specs/specship-desktop/ui.jsx).
 */
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './icons';

export interface StateStyle {
  label: string;
  color: string;
  bg: string;
}

export const STATE: Record<string, StateStyle> = {
  // workflow run states
  pending: { label: 'Pending', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' },
  running: { label: 'Running', color: 'var(--info)', bg: 'var(--info-soft)' },
  paused: { label: 'Paused', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  completed: { label: 'Completed', color: 'var(--success)', bg: 'var(--success-soft)' },
  failed: { label: 'Failed', color: 'var(--error)', bg: 'var(--error-soft)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' },
  skipped: { label: 'Skipped', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' },
  // spec link states
  drafted: { label: 'Drafted', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.05)' },
  implementing: { label: 'Implementing', color: 'var(--info)', bg: 'var(--info-soft)' },
  implemented: { label: 'Implemented', color: 'var(--node-spec)', bg: 'var(--node-spec-soft)' },
  verified: { label: 'Verified', color: 'var(--success)', bg: 'var(--success-soft)' },
  drifted: { label: 'Drifted', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  broken: { label: 'Broken', color: 'var(--error)', bg: 'var(--error-soft)' },
  orphaned: { label: 'Orphaned', color: 'var(--error)', bg: 'var(--error-soft)' },
  // generic
  success: { label: 'Success', color: 'var(--success)', bg: 'var(--success-soft)' },
  warn: { label: 'Warn', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  error: { label: 'Error', color: 'var(--error)', bg: 'var(--error-soft)' },
  info: { label: 'Info', color: 'var(--info)', bg: 'var(--info-soft)' },
};

const STATE_ICON: Record<string, string> = {
  drifted: 'drift', broken: 'cancel', orphaned: 'drift', failed: 'cancel',
  verified: 'check', completed: 'check', paused: 'pause', running: 'circle',
};

export function StatePill({ state, pulse, withDot }: { state: string; pulse?: boolean; withDot?: boolean }) {
  const c = STATE[state] ?? STATE.info!;
  const ic = STATE_ICON[state];
  return (
    <span className="pill" style={{ color: c.color, background: c.bg, animation: pulse ? 'pulsePill 600ms ease-out' : undefined }}>
      {withDot && <span className="pill-dot" style={{ background: c.color }} />}
      {ic && !withDot && <Icon name={ic} size={11} />}
      {c.label}
    </span>
  );
}

export function Pill({ children, color, bg, dot }: { children: ReactNode; color?: string; bg?: string; dot?: boolean }) {
  return (
    <span className="pill" style={{ color: color || 'var(--text-secondary)', background: bg || 'rgba(255,255,255,0.05)' }}>
      {dot && <span className="pill-dot" style={{ background: color }} />}
      {children}
    </span>
  );
}

/**
 * SAMPLE badge (REQ-DESKTOP-030.A2) — marks a module whose backend is not yet
 * implemented, so its data is illustrative reference, never presented as your
 * project's truth. A module backed by a real endpoint MUST NOT render this;
 * the design bundle's mock dataset never ships (guarded in check-ui-deps.mjs).
 */
export function SampleBadge({ title }: { title?: string }) {
  return (
    <span
      className="pill"
      data-sample-badge
      title={title ?? 'Illustrative reference data — not from your project'}
      style={{ color: 'var(--warn)', background: 'var(--warn-soft)', fontWeight: 700, letterSpacing: '0.04em' }}
    >
      SAMPLE
    </span>
  );
}

export function CopyBtn({ text, label, ariaLabel }: { text: string; label?: string; ariaLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-xs"
      title="Copy"
      aria-label={ariaLabel ?? (label ? undefined : 'Copy ' + text)}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }}
      style={{ color: done ? 'var(--success)' : undefined }}
    >
      <Icon name={done ? 'check' : 'copy'} size={12} />
      {label || ''}
    </button>
  );
}

/** Big delta indicator. `invert` when down is good (cost, drift). */
export function Delta({ value, suffix, invert }: { value: number; suffix?: string; invert?: boolean }) {
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className="row gap-2 tabular" style={{ color: good ? 'var(--success)' : 'var(--error)', fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
      <Icon name={up ? 'trendUp' : 'trendDown'} size={12} />
      {(up ? '+' : '') + (Math.abs(value) < 1 && value !== 0 ? Math.round(value * 100) + '%' : value) + (suffix || '')}
    </span>
  );
}

/** Page header used across screens. */
export function PageHead({ icon, title, sub, actions }: { icon?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row" style={{ gap: 12, marginBottom: 18, alignItems: 'flex-start' }}>
      {icon && (
        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', display: 'grid', placeItems: 'center', color: 'var(--accent)', flexShrink: 0 }}>
          <Icon name={icon} size={18} />
        </div>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-title)', fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
        {sub && <div className="secondary" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      {actions && <div className="row gap-8">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: string; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 280, textAlign: 'center', padding: 40 }}>
      <div style={{ maxWidth: 360 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', margin: '0 auto 16px' }}>
          <Icon name={icon || 'box'} size={24} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
        {body && <div className="secondary" style={{ lineHeight: 1.55 }}>{body}</div>}
        {action && <div style={{ marginTop: 16 }}>{action}</div>}
      </div>
    </div>
  );
}

export type SegmentedOption = string | { value: string; label: string };

/**
 * Segmented picker with radiogroup semantics (REQ-DESKTOP-014): one group,
 * one aria-checked member, roving tabindex, arrow keys move selection and
 * focus. Visual states are the token-driven `.seg*` classes (REQ-DESKTOP-013).
 */
// @implements REQ-DESKTOP-013
// @implements REQ-DESKTOP-014
export function Segmented({ options, value, onChange, size, label, disabled }: {
  options: SegmentedOption[]; value: string; onChange: (v: string) => void;
  size?: 'sm'; label?: string; disabled?: boolean;
}) {
  const vals = options.map((o) => (typeof o === 'string' ? o : o.value));
  const activeIdx = vals.indexOf(value);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + vals.length) % vals.length;
    onChange(vals[j]!);
    (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const v = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label;
        const active = v === value;
        return (
          <button
            key={v}
            role="radio"
            aria-checked={active}
            // Roving tabindex; with no checked member the first option is the
            // tab stop so the group stays keyboard-reachable.
            tabIndex={active || (activeIdx === -1 && i === 0) ? 0 : -1}
            disabled={disabled}
            className={'seg-btn' + (size === 'sm' ? ' sm' : '') + (active ? ' active' : '')}
            onClick={() => onChange(v)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {lab}
          </button>
        );
      })}
    </div>
  );
}

/** Range selector shared by the analytics screens (design bundle's ui.jsx). */
export function RangeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Segmented
      options={[
        { value: 'today', label: 'Today' }, { value: 'week', label: 'This week' },
        { value: 'month', label: 'This month' }, { value: 'all', label: 'All time' },
      ]}
      value={value}
      onChange={onChange}
      size="sm"
      label="Time range"
    />
  );
}

/** Mini horizontal bar (for cost rows etc.). */
export function Bar({ frac, color, height }: { frac: number; color?: string; height?: number }) {
  return (
    <div style={{ height: height || 4, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden', width: '100%' }}>
      <div style={{ width: Math.max(2, frac * 100) + '%', height: '100%', background: color || 'var(--accent)', borderRadius: 999 }} />
    </div>
  );
}

/** Compact relative age for link rows and metalines — "5m", "3h", "2d". */
export function timeAgo(ms?: number): string | null {
  if (!ms) return null;
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

export function nodeColor(kind: string, state?: string): string {
  if (kind === 'spec') {
    if (state === 'drifted') return 'var(--warn)';
    if (state === 'broken' || state === 'orphaned') return 'var(--error)';
    return 'var(--node-spec)';
  }
  if (kind === 'test') return 'var(--node-test)';
  if (kind === 'route') return 'var(--node-route)';
  return 'var(--node-code)';
}

export const kbdStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
  background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)',
  borderRadius: 4, padding: '2px 6px',
};

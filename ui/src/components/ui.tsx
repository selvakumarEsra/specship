/**
 * Shared UI kit + state-pill config. Originally a TSX port of the design
 * bundle's ui.jsx; restyled in the BookMyGame UI visual language with React
 * and CSS only (REQ-DASHTHEME-004) — every component's look and every state
 * comes from the kit classes in styles/app.css, which read tokens.css. Inline
 * styles here carry only `var(--token)` references, never literals.
 */
import { useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './icons';

export interface StateStyle {
  label: string;
  color: string;
  bg: string;
}

export const STATE: Record<string, StateStyle> = {
  // workflow run states
  pending: { label: 'Pending', color: 'var(--warning)', bg: 'var(--warning-soft)' },
  running: { label: 'Running', color: 'var(--info)', bg: 'var(--info-soft)' },
  paused: { label: 'Paused', color: 'var(--warning)', bg: 'var(--warning-soft)' },
  completed: { label: 'Completed', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  failed: { label: 'Failed', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)', bg: 'var(--fill-soft)' },
  // Parked, not terminal (WF-REJECT-DOC): worktree + artifacts kept, resume revises.
  rejected: { label: 'Rejected', color: 'var(--warning)', bg: 'var(--warning-soft)' },
  skipped: { label: 'Skipped', color: 'var(--text-muted)', bg: 'var(--fill-soft)' },
  // spec link states
  drafted: { label: 'Drafted', color: 'var(--text-secondary)', bg: 'var(--fill-soft)' },
  implementing: { label: 'Implementing', color: 'var(--info)', bg: 'var(--info-soft)' },
  implemented: { label: 'Implemented', color: 'var(--node-spec)', bg: 'var(--node-spec-soft)' },
  verified: { label: 'Verified', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  drifted: { label: 'Drifted', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  broken: { label: 'Broken', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  orphaned: { label: 'Orphaned', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  // generic
  success: { label: 'Success', color: 'var(--success)', bg: 'var(--success-soft)' },
  warn: { label: 'Warn', color: 'var(--warning)', bg: 'var(--warning-soft)' },
  error: { label: 'Error', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  info: { label: 'Info', color: 'var(--info)', bg: 'var(--info-soft)' },
};

const STATE_ICON: Record<string, string> = {
  drifted: 'drift', broken: 'cancel', orphaned: 'drift', failed: 'cancel',
  verified: 'check', completed: 'check', paused: 'pause', running: 'circle',
};

// @implements REQ-DASHTHEME-004
export function StatePill({ state, pulse, withDot }: { state: string; pulse?: boolean; withDot?: boolean }) {
  const c = STATE[state] ?? STATE.info!;
  const ic = STATE_ICON[state];
  return (
    <span className="pill" style={{ color: c.color, background: c.bg, animation: pulse ? 'pulsePill 600ms ease-out' : undefined }}>
      {withDot && <span className="pill-dot" />}
      {ic && !withDot && <Icon name={ic} size={11} />}
      {c.label}
    </span>
  );
}

/** Neutral badge; `color`/`bg` take token refs (defaults come from `.pill`). */
// @implements REQ-DASHTHEME-004
export function Pill({ children, color, bg, dot }: { children: ReactNode; color?: string; bg?: string; dot?: boolean }) {
  return (
    <span className="pill" style={color || bg ? { color, background: bg } : undefined}>
      {dot && <span className="pill-dot" />}
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

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'secondary' | 'destructive';

/**
 * Kit button (REQ-DASHTHEME-004): primary / ghost / outline (secondary and
 * destructive kept as aliases for existing screens), md / sm / xs. `loading`
 * disables the control and sets aria-busy, which the CSS renders as a
 * spinner. All states come from the `.btn*` rules (REQ-DESKTOP-013).
 */
// @implements REQ-DASHTHEME-004
export function Button({ variant = 'outline', size = 'md', loading, disabled, className, children, type, ...rest }: {
  variant?: ButtonVariant; size?: 'md' | 'sm' | 'xs'; loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = 'btn btn-' + variant + (size === 'md' ? '' : ' btn-' + size) + (className ? ' ' + className : '');
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {children}
    </button>
  );
}

// @implements REQ-DASHTHEME-004
export function CopyBtn({ text, label, ariaLabel }: { text: string; label?: string; ariaLabel?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="xs"
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
    </Button>
  );
}

/**
 * Toggle filter chip (REQ-DASHTHEME-004) — a small rounded rectangle, not a
 * pill. `active` is exposed as aria-pressed; `color`/`bg` (token refs) tint
 * the on state through the `--chip-color` / `--chip-bg` custom properties.
 */
// @implements REQ-DASHTHEME-004
export function Chip({ label, count, active, onClick, color, bg, dot, size, className, disabled }: {
  label: ReactNode; count?: number; active: boolean; onClick: () => void;
  color?: string; bg?: string; dot?: boolean; size?: 'sm'; className?: string; disabled?: boolean;
}) {
  const vars: Record<string, string> = {};
  if (color) vars['--chip-color'] = color;
  if (bg) vars['--chip-bg'] = bg;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={'chip' + (size === 'sm' ? ' sm' : '') + (active ? ' on' : '') + (className ? ' ' + className : '')}
      style={Object.keys(vars).length ? (vars as CSSProperties) : undefined}
    >
      {(dot ?? !!color) && <span className="chip-dot" />}
      {label}
      {count != null && <span className="chip-count">{count}</span>}
    </button>
  );
}

/**
 * Kit switch (REQ-DASHTHEME-004): role="switch" with aria-checked, a 44×26
 * pill track and 20×20 thumb (tokens.css --switch-*). `busy` disables it and
 * sets aria-busy while a save is in flight.
 */
// @implements REQ-DASHTHEME-004
export function Switch({ checked, onChange, label, disabled, busy, className }: {
  checked: boolean; onChange: () => void; label: string; disabled?: boolean; busy?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={'switch' + (className ? ' ' + className : '')}
      onClick={onChange}
    >
      <span className="switch-thumb" />
    </button>
  );
}

/**
 * Big delta indicator. `invert` when down is good (cost, drift).
 *
 * An absent value (no prior window to compare against) renders NOTHING, and a
 * measured zero renders a neutral "no change" — never a coloured arrow, which
 * would read as a trend the data doesn't support (REQ-REVINT-007.A2).
 */
export function Delta({ value, suffix, invert }: { value: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (value == null) return null;
  if (value === 0) {
    return (
      <span className="row gap-2 tabular muted" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600 }}>
        <Icon name="minus" size={12} />
        no change
      </span>
    );
  }
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
        <div data-page-title="" style={{ fontSize: 'var(--fs-title)', fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
        {sub && <div className="secondary" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      {actions && <div className="row gap-8">{actions}</div>}
    </div>
  );
}

// @implements REQ-DASHTHEME-004
export function Empty({ icon, title, body, action }: { icon?: string; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-icon">
          <Icon name={icon || 'box'} size={24} />
        </div>
        <div className="empty-title">{title}</div>
        {body && <div className="empty-body">{body}</div>}
        {action && <div className="empty-action">{action}</div>}
      </div>
    </div>
  );
}

/** Error state (REQ-DASHTHEME-004): the empty-state layout in the danger tone, announced as an alert. */
// @implements REQ-DASHTHEME-004
export function ErrorState({ title, detail, action, icon }: { title: ReactNode; detail?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="empty error-state" role="alert">
      <div className="empty-inner">
        <div className="empty-icon">
          <Icon name={icon || 'cancel'} size={24} />
        </div>
        <div className="empty-title">{title}</div>
        {detail && <div className="error-state-detail">{detail}</div>}
        {action && <div className="empty-action">{action}</div>}
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
// @implements REQ-DASHTHEME-004
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

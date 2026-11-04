/**
 * Shared dashboard card pieces: `Module` gives every card the shared loading /
 * error / retry treatment (REQ-DESKTOP-012 generalized by REQ-DESKTOP-030), and
 * `StatTile` is the clickable kit stat card (REQ-DASHTHEME-004). The transcript
 * analytics modules that used to live here were removed with the Dashboard
 * (REQ-DASHSIMPLE-002).
 */
import type { ReactNode } from 'react';
import type { ApiState } from '../hooks';
import { Sparkline } from './charts';
import { Icon } from './icons';
import { Button, Delta } from './ui';

/**
 * Loading / error-with-retry wrapper around one dashboard card. While the
 * first fetch is in flight it renders a skeleton sized like the module; a
 * failed fetch renders the shared error state with a Retry wired to the
 * ApiState's reload. Data renders through the children function.
 */
export function Module<T>({ state, label, minHeight, children }: {
  state: ApiState<T>;
  label: string;
  minHeight: number;
  children: (data: T) => ReactNode;
}) {
  if (state.data == null && state.loading) {
    return <div className="skel" style={{ minHeight, borderRadius: 10 }} aria-label={`Loading ${label}`} />;
  }
  if (state.data == null && state.error != null) {
    const msg = state.error instanceof Error ? state.error.message : String(state.error);
    return (
      <div className="card card-pad" style={{ minHeight, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div className="row gap-8" style={{ justifyContent: 'center', color: 'var(--error)' }}>
            <Icon name="cancel" size={14} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Couldn't load {label}</span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4, overflowWrap: 'anywhere' }}>{msg}</div>
          <Button variant="outline" size="xs" style={{ marginTop: 10 }} onClick={state.reload}>Retry</Button>
        </div>
      </div>
    );
  }
  if (state.data == null) return null;
  return <>{children(state.data)}</>;
}

// ---- Stat tiles ----

/** Stat tile (REQ-DASHTHEME-004): a clickable kit card; look and states come from `.card-btn` / `.stat-tile*`. */
// @implements REQ-DASHTHEME-004
export function StatTile({ icon, label, value, delta, deltaInvert, spark, sparkColor, color, note, onClick, className, disabled }: {
  icon: string; label: string; value: string; delta?: number; deltaInvert?: boolean;
  spark?: number[]; sparkColor?: string; color?: string; note?: string; onClick?: () => void;
  /** Gallery-only forced-state class (`is-hover` / `is-active`). */
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={'card card-btn stat-tile' + (className ? ' ' + className : '')}
    >
      <div className="row gap-8 muted">
        <Icon name={icon} size={13} style={{ color: color || 'var(--text-muted)' }} />
        <span className="eyebrow stat-tile-label">{label}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-sm)' }}>
        <div className="tabular display-num">{value}</div>
        {spark && spark.length > 1 && <Sparkline data={spark} color={sparkColor || color || 'var(--accent)'} fill w={64} h={22} />}
      </div>
      {note
        ? <div className="stat-tile-note">{note}</div>
        : delta !== undefined && <Delta value={delta} invert={deltaInvert} />}
    </button>
  );
}

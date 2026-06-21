/**
 * Shared state-pill config + node-color helper.
 * Ported 1:1 from the SpecShip Desktop design system (ui.jsx STATE / STATE_ICON / nodeColor).
 * Both the workflow-run states and the spec-link states share this table so a
 * `<app-state-pill>` renders identically wherever it appears.
 */

export interface StateConfig {
  label: string;
  color: string;
  bg: string;
}

export const STATE: Record<string, StateConfig> = {
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

export const STATE_ICON: Record<string, string> = {
  drifted: 'drift',
  broken: 'cancel',
  orphaned: 'drift',
  failed: 'cancel',
  verified: 'check',
  completed: 'check',
  paused: 'pause',
  running: 'circle',
};

/** Graph node fill colour by kind + (for specs) drift state. */
export function nodeColor(kind: string, state?: string | null): string {
  if (kind === 'spec') {
    if (state === 'drifted') return 'var(--warn)';
    if (state === 'broken' || state === 'orphaned') return 'var(--error)';
    return 'var(--node-spec)';
  }
  if (kind === 'test') return 'var(--node-test)';
  if (kind === 'route') return 'var(--node-route)';
  return 'var(--node-code)';
}

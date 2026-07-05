/**
 * Shared pieces for the Claude Code analytics screens (REQ-DESKTOP-024):
 * the full-page A3 ingest guidance, and the small formatting helpers the
 * Sessions / Heatmap / Costs / Compare / Tips pages have in common
 * (ported from specs/specship-desktop/screens-claude.jsx).
 */
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../api';
import { useIngestConfig } from '../hooks';
import { go } from '../router';
import { Icon } from './icons';
import { Empty } from './ui';

/**
 * A3 guidance: zero ingested sessions means these screens have no truth to
 * render — point at the Settings ingest toggle instead of fabricating
 * zero-valued charts (REQ-DESKTOP-024.A3). Mirrors the dashboard's
 * NeedsIngest treatment at page scale; the button forces a one-shot pass.
 */
export function IngestGuidance({ onIngested }: { onIngested?: () => void }) {
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    api.ingestNow()
      .catch(() => undefined)
      .finally(() => { setRunning(false); onIngested?.(); });
  };
  return (
    <Empty
      icon="database"
      title="No Claude Code data ingested yet"
      body="This screen lights up once SpecShip ingests your transcripts from ~/.claude/projects. Turn on transcript ingest in Settings, or run a one-shot pass now."
      action={
        <button className="btn btn-secondary btn-sm" onClick={run} disabled={running}>
          {running ? 'Ingesting…' : 'Run ingest now'}
        </button>
      }
    />
  );
}

/**
 * Warn strip the analytics screens show while the server-side transcript
 * ingest toggle is OFF (REQ-DESKTOP-028.A2): the data below is real but
 * frozen at the last ingest pass. Driven by /api/config via useIngestConfig,
 * so flipping the Settings toggle updates these screens without a reload.
 */
export function IngestDisabledBanner() {
  const config = useIngestConfig();
  if (!config.data || config.data.ingestEnabled) return null;
  const openSettings = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go('settings');
  };
  return (
    <div role="status" className="row gap-8" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 12.5, marginBottom: 14 }}>
      <Icon name="drift" size={14} style={{ flexShrink: 0 }} />
      <span className="grow">Transcript ingest is off — this data is frozen at the last ingest pass.</span>
      <a href="/settings" onClick={openSettings} style={{ color: 'var(--warn)', fontWeight: 600, flexShrink: 0 }}>Turn on in Settings</a>
    </div>
  );
}

/** Cache-hit-rate color ramp shared by the analytics tables (design's cacheColor). */
export function cacheColor(v: number): string {
  return v >= 0.7 ? 'var(--success)' : v >= 0.5 ? 'var(--warn)' : 'var(--error)';
}

/** Session-level cache read rate: reads / (input + writes + reads). */
export function sessionCacheRate(s: { total_input_tokens?: number; total_cache_creation_tokens?: number; total_cache_read_tokens?: number }): number {
  const total = (s.total_input_tokens ?? 0) + (s.total_cache_creation_tokens ?? 0) + (s.total_cache_read_tokens ?? 0);
  return total > 0 ? (s.total_cache_read_tokens ?? 0) / total : 0;
}

/** Model ids read better without the redundant vendor prefix. */
export function modelShort(model: string): string {
  return model.replace(/^claude-/, '');
}

/** Stable per-page categorical colors for model breakdowns (donut, stacks). */
const MODEL_COLORS = ['var(--node-spec)', 'var(--node-code)', 'var(--node-route)', 'var(--node-test)', 'var(--accent)', 'var(--warn)'];
export function modelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length]!;
}

/** Wall-clock time of day for prompt/session rows — "14:03". */
export function fmtTime(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Compact date + time for session windows — "Jul 5, 14:03". */
export function fmtWhen(ms?: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Compact duration — "1h 12m", "9m", "42s". */
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

/** Small labeled stat used in the detail strips (design's stat()). */
export function StatBlock({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="mono tabular" style={{ fontSize: 16, fontWeight: 600, marginTop: 2, color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

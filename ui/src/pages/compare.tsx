/**
 * Compare projects — which projects are cost-efficient vs hungry
 * (REQ-DESKTOP-024): project toggle chips, the most-efficient callout, the
 * comparison table and the per-project cost-by-model stacked bars, arranged
 * per specs/specship-desktop/screens-claude.jsx Compare.
 */
import { useState } from 'react';
import { api, type ClaudeCompareProject } from '../api';
import { cacheColor, IngestGuidance, modelColor, modelShort } from '../components/claude-analytics';
import { StackedBars, type StackedSegment } from '../components/charts';
import { Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { PageHead } from '../components/ui';
import { useApi } from '../hooks';
import type { PageProps } from './types';

/** Real project names are absolute cwds — label with the last segment. */
const projLabel = (p: { name: string; path: string }): string => {
  const base = p.name || p.path;
  return base.split('/').filter(Boolean).pop() ?? base;
};

// @implements REQ-DESKTOP-024
export function ComparePage(_props: PageProps) {
  const stats = useApi(() => api.claudeStats(), []);
  const compare = useApi(() => api.claudeCompare(), []);
  // Toggled-OFF project paths — everything is included until excluded, which
  // survives the async load (the design seeds an all-selected Set instead).
  const [off, setOff] = useState<Set<string>>(new Set());

  const noIngest = stats.data?.sessionCount === 0;
  const reload = () => { stats.reload(); compare.reload(); };
  const toggle = (path: string) =>
    setOff((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <PageHead icon="compare" title="Compare projects" sub="Which projects are cost-efficient vs hungry" />
      {noIngest ? <IngestGuidance onIngested={reload} /> : (
        <Module state={compare} label="project comparison" minHeight={280}>
          {(d) => (d.projects.length
            ? <CompareBody projects={d.projects} off={off} onToggle={toggle} />
            : <IngestGuidance onIngested={reload} />)}
        </Module>
      )}
    </div>
  );
}

function CompareBody({ projects, off, onToggle }: {
  projects: ClaudeCompareProject[]; off: Set<string>; onToggle: (path: string) => void;
}) {
  const rows = projects.filter((p) => !off.has(p.path));
  const best = [...rows].sort((a, b) => (b.cacheHit - b.avgCost / 100) - (a.cacheHit - a.avgCost / 100))[0];

  // Stacked-bar segments: the models seen across the selected rows, ranked by
  // total cost so the palette stays stable while rows toggle in and out.
  const modelTotals = new Map<string, number>();
  for (const p of rows) for (const m of p.byModel) modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + m.cost);
  const segs: StackedSegment[] = [...modelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([m], i) => ({ key: m, label: modelShort(m), color: modelColor(i) }));
  const barRows = rows.map((p) => ({
    label: projLabel(p),
    values: Object.fromEntries(p.byModel.map((m) => [m.model, m.cost])),
  }));

  const th = (t: string, w = 70) => <span style={{ width: w, textAlign: 'right' as const }}>{t}</span>;
  const td = (v: string | number, w = 70) => <span className="mono tabular" style={{ width: w, textAlign: 'right', fontSize: 12 }}>{v}</span>;

  return (
    <>
      <div className="row gap-6" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {projects.map((p) => {
          const on = !off.has(p.path);
          return (
            <button
              key={p.path}
              onClick={() => onToggle(p.path)}
              aria-pressed={on}
              title={p.path}
              style={{
                height: 28, padding: '0 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)',
                border: '1px solid ' + (on ? 'transparent' : 'var(--border-subtle)'),
                background: on ? 'var(--accent-soft)' : 'var(--bg-panel)',
                color: on ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {projLabel(p)}
            </button>
          );
        })}
      </div>

      {best && (
        <div className="card card-pad" style={{ marginBottom: 14, borderColor: 'rgba(70,194,107,0.3)', background: 'var(--success-soft)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ color: 'var(--success)' }}><Icon name="sparkles" size={18} /></div>
          <div className="grow">
            <span style={{ fontWeight: 600, fontSize: 13 }}>Most efficient: </span>
            <span className="mono" style={{ color: 'var(--success)' }}>{projLabel(best)}</span>
            <span className="secondary" style={{ fontSize: 12.5 }}>
              {' '}— {Math.round(best.cacheHit * 100)}% cache hit, ${best.avgCost.toFixed(2)} avg/session{best.drift ? `, ${best.drift} drifted links` : ', no drifted links'}.
            </span>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        <div className="row" style={{ padding: '9px 14px', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="grow">Project</span>
          {th('Cost')}{th('Sessions')}{th('Avg')}{th('Cache')}
          <span style={{ width: 60, textAlign: 'right' }}>Drift</span>
          <span style={{ width: 150, textAlign: 'right' }}>Top tools</span>
        </div>
        {rows.map((p) => (
          <div key={p.path} className="row" style={{ padding: '11px 14px', borderTop: '1px solid var(--border-subtle)' }}>
            <span className="mono grow" style={{ fontSize: 12.5, color: best && p.path === best.path ? 'var(--success)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }} title={p.path}>
              {projLabel(p)}
            </span>
            {td('$' + p.cost.toFixed(0))}
            {td(p.sessions)}
            {td('$' + p.avgCost.toFixed(2))}
            <span className="mono tabular" style={{ width: 70, textAlign: 'right', fontSize: 12, color: cacheColor(p.cacheHit) }}>{Math.round(p.cacheHit * 100)}%</span>
            <span className="mono tabular" style={{ width: 60, textAlign: 'right', fontSize: 12, color: p.drift > 10 ? 'var(--warn)' : 'var(--text-secondary)' }}>{p.drift}</span>
            <span className="row gap-4" style={{ width: 150, justifyContent: 'flex-end', overflow: 'hidden' }}>
              {p.topTools.map((t) => (
                <code key={t} className="mono" style={{ fontSize: 9.5, background: 'var(--bg-canvas)', padding: '1px 5px', borderRadius: 3, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t}</code>
              ))}
            </span>
          </div>
        ))}
        {!rows.length && <div className="muted" style={{ fontSize: 12, padding: '14px' }}>Every project is toggled off — pick at least one above.</div>}
      </div>

      {rows.length > 0 && segs.length > 0 && (
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="row gap-8">
              <Icon name="dollar" size={14} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 600, fontSize: 12.5 }}>Cost by model per project</span>
            </div>
            <div className="row gap-12">
              {segs.map((s) => (
                <span key={s.key} className="row gap-4 muted" style={{ fontSize: 10.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          <StackedBars rows={barRows} segments={segs} fmt={(v) => '$' + v.toFixed(0)} />
        </div>
      )}
    </>
  );
}

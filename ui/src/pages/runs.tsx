/**
 * Runs screen — recent workflow executions with status filter and columns
 * per the design bundle's Runs (specs/specship-desktop/screens-workflows.jsx);
 * `/runs/:id` renders the run detail (REQ-DESKTOP-023). The Launch-run
 * affordance leads to the Workflows screen (not a sidebar entry).
 */
import { useState } from 'react';
import { api, isNoProject, type WorkflowRun } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from '../components/icons';
import { RunDetail, fmtCost, fmtDuration } from '../components/run-detail';
import { Empty, PageHead, Segmented, StatePill, timeAgo } from '../components/ui';
import type { PageProps } from './types';

const STATUSES = ['running', 'paused', 'rejected', 'completed', 'failed', 'cancelled'];

function asMs(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : new Date(String(v)).getTime();
  return Number.isFinite(n) ? n : null;
}

function rowDuration(r: WorkflowRun): string {
  const start = asMs(r.startedAt);
  if (!start) return '—';
  const end = asMs(r.completedAt) ?? asMs(r.finishedAt) ?? asMs(r.lastActivityAt as string | number | undefined);
  return fmtDuration(end !== null ? end - start : null);
}

// @implements REQ-DESKTOP-023
export function RunsPage({ project, param }: PageProps) {
  if (param) return <RunDetail id={param} project={project} />;
  return <RunsList project={project} />;
}

function RunsList({ project }: { project: string | null }) {
  const runs = useApi(() => api.runs(project), [project]);
  const [statusF, setStatusF] = useState<string | null>(null);

  if (isNoProject(runs.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const all = runs.data?.runs ?? [];
  const list = statusF ? all.filter((r) => r.status === statusF) : all;

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <PageHead
          icon="play"
          title="Runs"
          sub={runs.data ? `${all.length} workflow runs` : 'Loading runs…'}
          actions={
            <button className="btn btn-primary btn-sm" onClick={() => go('workflows')}>
              <Icon name="play" size={13} />Launch run
            </button>
          }
        />
      </div>
      <div className="row gap-6" style={{ padding: '0 18px 12px' }}>
        <Segmented
          size="sm"
          label="Run status filter"
          value={statusF ?? 'all'}
          onChange={(v) => setStatusF(v === 'all' ? null : v)}
          options={[{ value: 'all', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))]}
        />
      </div>
      {runs.data && !all.length ? (
        <Empty
          icon="play"
          title="No runs yet"
          body="Workflow runs started from the CLI or dashboard land here."
          action={<button className="btn btn-secondary btn-sm" onClick={() => go('workflows')}>Browse workflows</button>}
        />
      ) : (
        <div className="scroll-y" style={{ padding: '0 18px 18px' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="row" style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              <span style={{ width: 100 }}>Status</span>
              <span className="grow">Workflow</span>
              <span style={{ width: 90 }}>Duration</span>
              <span style={{ width: 130 }}>Model</span>
              <span style={{ width: 70, textAlign: 'right' }}>Cost</span>
              <span style={{ width: 60, textAlign: 'right' }}>When</span>
            </div>
            {list.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                className="row list-row"
                onClick={() => go('runs', { param: r.id })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('runs', { param: r.id }); } }}
                style={{ padding: '11px 14px', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}
              >
                <span style={{ width: 100, flexShrink: 0 }}><StatePill state={r.status} /></span>
                <div className="grow row gap-8" style={{ minWidth: 0 }}>
                  <span className="mono" style={{ fontSize: 12.5 }}>{String(r.workflowName ?? r.workflowId ?? '—')}</span>
                  <span className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.id}</span>
                </div>
                <span className="mono tabular muted" style={{ width: 90, flexShrink: 0, fontSize: 11.5 }}>{rowDuration(r)}</span>
                <span className="mono muted" style={{ width: 130, flexShrink: 0, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.model ?? '—'}</span>
                <span className="mono tabular" style={{ width: 70, flexShrink: 0, textAlign: 'right', fontSize: 12 }}>{fmtCost(r.totalCostUsd)}</span>
                <span className="mono muted tabular" style={{ width: 60, flexShrink: 0, textAlign: 'right', fontSize: 11 }}>
                  {timeAgo(asMs(r.startedAt) ?? undefined) ?? '—'}
                </span>
              </div>
            ))}
            {runs.data && !list.length && (
              <div className="muted" style={{ padding: '14px', fontSize: 12, borderTop: '1px solid var(--border-subtle)' }}>No runs match this filter.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

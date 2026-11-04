/**
 * Overview (REQ-DASHSIMPLE-002) — replaces the transcript-fed Dashboard with one
 * screen of agent-agnostic facts: the Review group counts (each opening Review
 * filtered to its group), index freshness, and the five most recent workflow
 * runs with the agent each ran on. It reads only status, spec coverage, drift
 * and runs — never a token, cost, session or transcript endpoint. The layout is
 * a fixed grid that fits a 1280×800 viewport without scrolling.
 */
import { useMemo } from 'react';
import {
  api,
  isNoProject,
  runAgentName,
  type DriftResponse,
  type SpecCoverageResponse,
  type StatusResponse,
  type WorkflowRun,
} from '../api';
import { useApi, type ApiState } from '../hooks';
import { Module, StatTile } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { Empty, PageHead, StatePill, timeAgo } from '../components/ui';
import { DRIFT_STATES, REVIEW_GROUPS, groupRequirements, type ReviewGroup } from '../review-groups';
import { go } from '../router';
import type { PageProps } from './types';

/** How many runs the Overview lists (A2). */
export const RECENT_RUNS = 5;

/** Same page size Review asks for, so both screens classify the same links. */
const DRIFT_LIMIT = 500;

/** The one next step a project with no specs gets (A4) — agent-neutral, no slash command. */
export const FIRST_SPEC_STEP = 'Write your first spec as a Markdown file under specs/, then run specship sync.';

const GROUP_LABEL: Record<ReviewGroup, string> = { drifted: 'Drifted', pending: 'Pending', completed: 'Completed' };
const GROUP_ICON: Record<ReviewGroup, string> = { drifted: 'drift', pending: 'circle', completed: 'check' };
const GROUP_COLOR: Record<ReviewGroup, string> = { drifted: 'var(--danger)', pending: 'var(--warning)', completed: 'var(--accent)' };

const BORDER = 'var(--control-border-w) solid var(--border-subtle)';
const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

interface ReviewInputs {
  coverage: SpecCoverageResponse;
  drift: DriftResponse;
}

const asMs = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : new Date(String(v)).getTime();
  return Number.isFinite(n) ? n : null;
};

/**
 * The Overview's data: status, coverage, drift and runs — nothing else. The
 * coverage + drift pair is merged into one state so the counts card loads,
 * fails and retries as a unit.
 */
// @implements REQ-DASHSIMPLE-002
export function useOverviewData(project: string | null) {
  const pk = project ?? '_';
  const status = useApi(() => api.status(project), [project], { cacheKey: `status:${pk}` });
  const coverage = useApi(() => api.specCoverage(null, project), [project], { cacheKey: `coverage:${pk}` });
  const drift = useApi(
    () => api.drift(project, { states: DRIFT_STATES, limit: DRIFT_LIMIT }),
    [project],
    { cacheKey: `drift:${pk}` },
  );
  const runs = useApi(() => api.runs(project), [project], { cacheKey: `runs:${pk}` });

  const review: ApiState<ReviewInputs> = {
    data: coverage.data && drift.data ? { coverage: coverage.data, drift: drift.data } : null,
    error: coverage.error ?? drift.error,
    loading: coverage.loading || drift.loading,
    reload: () => { coverage.reload(); drift.reload(); },
  };
  return { status, review, runs };
}

// @implements REQ-DASHSIMPLE-002
export function DashboardPage({ project }: PageProps) {
  const { status, review, runs } = useOverviewData(project);

  if (isNoProject(status.error) || isNoProject(review.error) || isNoProject(runs.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const s = status.data;
  const projectName = s ? (s.projectPath.split('/').filter(Boolean).pop() ?? s.projectPath) : '';
  const reqCount = review.data?.coverage.requirements.length;

  const head = (
    <PageHead
      icon="dashboard"
      title="Overview"
      sub={s ? `${projectName}${reqCount != null ? ` · ${reqCount} requirements` : ''}` : 'Loading project status…'}
    />
  );

  // A4: no specs → one next step, none of the other sections.
  if (reqCount === 0) {
    return (
      <div className="col" style={{ flex: 1, minHeight: 0, padding: 'var(--space-lg)' }}>
        {head}
        <OverviewEmpty />
      </div>
    );
  }

  return (
    <div
      data-testid="overview"
      style={{
        flex: 1, minHeight: 0, overflow: 'hidden', padding: 'var(--space-lg)',
        display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', gap: 'var(--space-md)',
      }}
    >
      {head}
      <Module state={review} label="requirement counts" minHeight={96}>
        {(d) => <OverviewCounts coverage={d.coverage} drift={d.drift} />}
      </Module>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--space-md)', minHeight: 0 }}>
        <Module state={status} label="index freshness" minHeight={160}>
          {(d) => <IndexFreshness status={d} />}
        </Module>
        <Module state={runs} label="recent runs" minHeight={160}>
          {(d) => <RecentRuns runs={d.runs} />}
        </Module>
      </div>
    </div>
  );
}

/** A1: the three Review group counts — same classifier as Review, so they always agree. */
// @implements REQ-DASHSIMPLE-002
export function OverviewCounts({ coverage, drift }: ReviewInputs) {
  const groups = useMemo(() => groupRequirements(coverage.requirements, drift.links), [coverage, drift]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${REVIEW_GROUPS.length}, 1fr)`, gap: 'var(--space-md)' }}>
      {REVIEW_GROUPS.map((g) => (
        <div key={g} data-overview-count={g} style={{ display: 'grid' }}>
          <StatTile
            icon={GROUP_ICON[g]}
            color={GROUP_COLOR[g]}
            label={GROUP_LABEL[g]}
            value={groups[g].length.toLocaleString()}
            note="Open in Review"
            onClick={() => go('review', { query: { group: g } })}
          />
        </div>
      ))}
    </div>
  );
}

/** A2: when the index was last refreshed, plus what it holds. */
// @implements REQ-DASHSIMPLE-002
export function IndexFreshness({ status }: { status: StatusResponse }) {
  const at = asMs(status.lastIndexed);
  const age = at != null ? timeAgo(at) : null;
  const text = age == null ? 'Never indexed — run specship index' : age === 'now' ? 'Indexed just now' : `Indexed ${age} ago`;
  return (
    <div className="card card-pad col gap-8" data-testid="index-freshness" style={{ height: '100%' }}>
      <div className="row gap-8">
        <Icon name="refresh" size={14} style={{ color: 'var(--accent)' }} />
        <span className="eyebrow">Index freshness</span>
      </div>
      <div
        data-testid="freshness-text"
        title={at != null ? new Date(at).toLocaleString() : undefined}
        style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}
      >
        {text}
      </div>
      <div className="muted tabular" style={{ fontSize: 'var(--fs-sm)' }}>
        {status.fileCount.toLocaleString()} files · {status.nodeCount.toLocaleString()} symbols · {status.edgeCount.toLocaleString()} edges
      </div>
    </div>
  );
}

/** A2: the newest five runs — status and the agent recorded on the run. No model, no cost. */
// @implements REQ-DASHSIMPLE-002
export function RecentRuns({ runs }: { runs: WorkflowRun[] }) {
  const recent = useMemo(
    () => [...runs]
      .map((r, i) => ({ r, i, at: asMs(r.startedAt) }))
      .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.i - b.i)
      .slice(0, RECENT_RUNS)
      .map((x) => x.r),
    [runs],
  );
  return (
    <div className="card col" data-testid="recent-runs" style={{ height: '100%', overflow: 'hidden' }}>
      <div className="row gap-8" style={{ padding: 'var(--space-sm) var(--space-md)', borderBottom: BORDER }}>
        <Icon name="play" size={14} style={{ color: 'var(--accent)' }} />
        <span className="eyebrow grow">Recent runs</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => go('runs')}>
          All runs<Icon name="arrowRight" size={11} />
        </button>
      </div>
      {recent.length === 0 ? (
        <div className="muted" style={{ padding: 'var(--space-md)', fontSize: 'var(--fs-sm)' }}>
          No workflow runs yet — start one with specship workflow run.
        </div>
      ) : (
        <div className="col">
          {recent.map((r) => {
            const agent = runAgentName(r);
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                data-run-row={r.id}
                className="row gap-8 list-row"
                onClick={() => go('runs', { param: r.id })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('runs', { param: r.id }); } }}
                style={{ padding: 'var(--space-sm) var(--space-md)', borderBottom: BORDER, cursor: 'pointer', minWidth: 0 }}
              >
                <span data-testid="run-status" style={{ flexShrink: 0 }}><StatePill state={r.status} /></span>
                <span className="mono grow" style={{ ...ELLIPSIS, fontSize: 'var(--fs-sm)' }}>
                  {String(r.workflowName ?? r.workflowId ?? '—')}
                </span>
                <span className="mono muted" data-testid="run-agent" title="Agent" style={{ flexShrink: 0, fontSize: 'var(--fs-xs)' }}>
                  {agent ?? '—'}
                </span>
                <span className="mono muted tabular" style={{ flexShrink: 0, fontSize: 'var(--fs-xs)' }}>
                  {timeAgo(asMs(r.startedAt) ?? undefined) ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A4: a project with no specs gets exactly one next step — no empty tiles or charts. */
// @implements REQ-DASHSIMPLE-002
export function OverviewEmpty() {
  return (
    <div data-testid="overview-empty" style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <Empty icon="book" title="No specs yet" body={FIRST_SPEC_STEP} />
    </div>
  );
}

/**
 * Review screen (REQ-DASHSIMPLE-004) — replaces the old Specs and Drift queue
 * screens. Every requirement sits in exactly one group (Drifted / Pending /
 * Completed, see review-groups.ts); the group filter lives in `?group=` and
 * the opened requirement in the path (`/review/<id>`), so every view has a
 * shareable URL. Built only from the shared UI kit and tokens.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { SpecDetail, type SpecDetailCache } from '../components/spec-detail';
import { Button, Empty, ErrorState, PageHead, Pill, Segmented, StatePill } from '../components/ui';
import { DRIFT_STATES, REVIEW_GROUPS, groupRequirements, type ReviewGroup, type ReviewRow } from '../review-groups';
import type { PageProps } from './types';

type Tab = 'all' | ReviewGroup;

const GROUP_LABEL: Record<ReviewGroup, string> = { drifted: 'Drifted', pending: 'Pending', completed: 'Completed' };

/** The server's maximum page — Review must see every drifted link it can. */
const DRIFT_LIMIT = 500;

const isTab = (v: string | undefined): v is Tab => v === 'all' || (REVIEW_GROUPS as string[]).includes(v ?? '');

const BORDER = 'var(--control-border-w) solid var(--border-subtle)';

/** Long ids and titles stay on one line (REQ-DESKTOP-015.A2). */
const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/** Rewrite the address bar for the current view without remounting the screen. */
function syncUrl(sel: string | null, tab: Tab): void {
  const path = '/review' + (sel ? '/' + sel : '') + (tab !== 'all' ? '?group=' + tab : '');
  if (path !== location.pathname + location.search) history.replaceState(history.state, '', path);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// @implements REQ-DASHSIMPLE-004
export function ReviewPage({ project, param, query }: PageProps) {
  const coverageQ = useApi(() => api.specCoverage(null, project), [project]);
  const driftQ = useApi(() => api.drift(project, { states: DRIFT_STATES, limit: DRIFT_LIMIT }), [project]);

  const [tab, setTab] = useState<Tab>(isTab(query.group) ? query.group : 'all');
  useEffect(() => { if (isTab(query.group)) setTab(query.group); }, [query.group]);

  // `/review/<id>` (and the retired `?sel=`) opens a requirement.
  const [sel, setSel] = useState<string | null>(param ?? query.sel ?? null);
  useEffect(() => {
    const target = param ?? query.sel;
    if (target) setSel(target);
  }, [param, query.sel]);
  const detailCache = useRef<SpecDetailCache>(new Map()).current;

  const groups = useMemo(
    () => groupRequirements(coverageQ.data?.requirements ?? [], driftQ.data?.links ?? []),
    [coverageQ.data, driftQ.data],
  );

  const pickTab = (v: string) => {
    if (!isTab(v)) return;
    setTab(v);
    syncUrl(sel, v);
  };
  const open = (id: string) => {
    setSel(id);
    syncUrl(id, tab);
  };

  if (isNoProject(coverageQ.error) || isNoProject(driftQ.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  // A7: a failed load is an error with a retry — never three empty groups.
  const failed = coverageQ.error ?? driftQ.error;
  if (failed) {
    return (
      <ErrorState
        title="Couldn’t load the review queue"
        detail={(coverageQ.error ? 'Spec coverage: ' : 'Spec links: ') + errorText(failed)}
        action={(
          <Button variant="primary" size="sm" onClick={() => { coverageQ.reload(); driftQ.reload(); }}>
            Retry
          </Button>
        )}
      />
    );
  }

  if (!coverageQ.data || !driftQ.data) {
    return <Empty icon="refresh" title="Loading the review queue…" />;
  }

  const total = REVIEW_GROUPS.reduce((n, g) => n + groups[g].length, 0);
  if (!total) {
    return <Empty icon="book" title="No requirements yet" body="Author a spec under specs/ — requirements show here once it is indexed." />;
  }

  const shown = tab === 'all' ? REVIEW_GROUPS : [tab];
  const options = [
    { value: 'all', label: `All (${total})` },
    ...REVIEW_GROUPS.map((g) => ({ value: g, label: `${GROUP_LABEL[g]} (${groups[g].length})` })),
  ];

  return (
    <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
      <div className="col grow" style={{ minWidth: 0, borderRight: BORDER }}>
        <div style={{ padding: 'var(--space-lg) var(--space-lg) 0' }}>
          <PageHead
            icon="drift"
            title="Review"
            sub={`${total} requirements · ${groups.drifted.length} drifted · ${groups.pending.length} pending · ${groups.completed.length} completed`}
          />
          <div style={{ paddingBottom: 'var(--space-md)' }}>
            <Segmented options={options} value={tab} onChange={pickTab} size="sm" label="Review group" />
          </div>
        </div>
        <div className="scroll-y" style={{ flex: 1, borderTop: BORDER }}>
          {shown.map((g) => (
            <section key={g} data-testid={'review-group-' + g} aria-label={GROUP_LABEL[g]}>
              <div className="eyebrow row gap-6" style={{ padding: 'var(--space-md) var(--space-lg) var(--space-xs)' }}>
                {GROUP_LABEL[g]}
                <span className="tabular">{groups[g].length}</span>
              </div>
              {groups[g].length === 0 ? (
                <div className="muted" style={{ padding: 'var(--space-xs) var(--space-lg) var(--space-md)', fontSize: 'var(--fs-sm)' }}>
                  Nothing {GROUP_LABEL[g].toLowerCase()}.
                </div>
              ) : (
                <div role="listbox" aria-label={GROUP_LABEL[g] + ' requirements'}>
                  {groups[g].map((r) => (
                    <ReviewRowItem key={r.specId} row={r} active={sel === r.specId} onOpen={open} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
      <div className="col grow" style={{ minWidth: 0 }}>
        <SpecDetail key={sel ?? ''} id={sel} project={project} cache={detailCache} />
      </div>
    </div>
  );
}

function ReviewRowItem({ row, active, onOpen }: { row: ReviewRow; active: boolean; onOpen: (id: string) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(row.specId); }
  };
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      data-review-row={row.specId}
      data-group={row.group}
      className={'list-row' + (active ? ' selected' : '')}
      onClick={() => onOpen(row.specId)}
      onKeyDown={onKey}
      style={{ padding: 'var(--space-sm) var(--space-lg)', borderBottom: BORDER, cursor: 'pointer' }}
    >
      <div className="row gap-8" style={{ minWidth: 0 }}>
        <StatePill state={row.group} />
        <span className="mono" style={{ ...ELLIPSIS, fontSize: 'var(--fs-sm)', color: 'var(--node-spec)' }}>{row.specId}</span>
        <span className="secondary grow" style={{ ...ELLIPSIS, fontSize: 'var(--fs-sm)' }}>{row.title}</span>
        {row.tag && <Pill>{row.tag}</Pill>}
        {row.untestedCount && (
          <span data-testid="untested-count">
            <Pill>{`${row.untestedCount.untested} of ${row.untestedCount.total} criteria untested`}</Pill>
          </span>
        )}
      </div>
      {row.driftReasons.length > 0 && (
        <div className="col gap-4" data-testid="drift-reasons" style={{ paddingTop: 'var(--space-xs)' }}>
          {row.driftReasons.map((d, i) => (
            <div key={i} className="row gap-6" style={{ flexWrap: 'wrap', fontSize: 'var(--fs-xs)' }}>
              <StatePill state={d.state} />
              <span className="mono" data-testid="drift-target">{d.target}</span>
              <Pill>{d.changed} changed</Pill>
              {d.kind && <span data-testid="drift-kind"><Pill>{d.kind}</Pill></span>}
              <span className="muted">fix:</span>
              <code className="mono" data-testid="drift-fix">{d.fix}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

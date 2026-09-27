/**
 * Traceability matrix — one row per requirement: code links, proving-test
 * links, criteria met N/M, rolled-up verdict, and drift age (REQ-TVIZ-008).
 *
 * The verdicts come from GET /api/spec/coverage, the Wave 2 rollup
 * (REQ-VSTATE-006). This page deliberately derives NO state of its own
 * (REQ-TVIZ-008.A2): the dashboard already had one state derivation in the
 * spec tree and another in the detail pane, and a third would guarantee three
 * different answers to "is this verified". Drift age is the one thing the
 * coverage report doesn't carry, so it's joined in from /api/drift.
 */
import { useMemo, useState } from 'react';
import { api, isNoProject, type CoverageVerdict, type RequirementCoverage } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from '../components/icons';
import { Empty, PageHead, Pill, STATE, timeAgo } from '../components/ui';
import type { PageProps } from './types';

/** Verdict → pill styling. Mirrors the spec detail headline's vocabulary. */
const VERDICT: Record<CoverageVerdict, { label: string; color: string; bg: string }> = {
  untested: { label: 'Untested', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  tested: { label: 'Tested', color: 'var(--info)', bg: 'var(--info-soft)' },
  verified: { label: 'Verified', color: 'var(--success)', bg: 'var(--success-soft)' },
  broken: { label: 'Broken', color: 'var(--error)', bg: 'var(--error-soft)' },
};

const VERDICTS: CoverageVerdict[] = ['untested', 'tested', 'verified', 'broken'];

export type SortKey = 'spec' | 'doc' | 'code' | 'tests' | 'criteria' | 'state' | 'drift';

/** One matrix row: coverage + the document and drift facts joined onto it. */
export interface MatrixRow {
  specId: string;
  title: string;
  doc: string;
  code: number;
  tests: number;
  criteriaWithTests: number;
  criteriaCount: number;
  verdict: CoverageVerdict;
  /** Most recent drift/broken/orphaned link timestamp, or null when clean. */
  driftAt: number | null;
}

/** Verdict ordering for the state column — worst first, so sorting surfaces work. */
const VERDICT_RANK: Record<CoverageVerdict, number> = { broken: 0, untested: 1, tested: 2, verified: 3 };

/**
 * Join coverage rows to their document path and drift age, then sort.
 * Exported so the ordering is testable without rendering.
 */
export function buildRows(
  coverage: RequirementCoverage[],
  docBySpec: Map<string, string>,
  driftBySpec: Map<string, number>,
  sort: SortKey,
  asc: boolean,
): MatrixRow[] {
  const rows: MatrixRow[] = coverage.map((c) => ({
    specId: c.specId,
    title: c.title,
    doc: docBySpec.get(c.specId) ?? '—',
    code: c.implementsLinks.count,
    tests: c.testsLinks.count,
    criteriaWithTests: c.criteriaWithTests,
    criteriaCount: c.criteriaCount,
    verdict: c.verdict,
    driftAt: driftBySpec.get(c.specId) ?? null,
  }));
  const dir = asc ? 1 : -1;
  const cmp: Record<SortKey, (a: MatrixRow, b: MatrixRow) => number> = {
    spec: (a, b) => a.specId.localeCompare(b.specId),
    doc: (a, b) => a.doc.localeCompare(b.doc) || a.specId.localeCompare(b.specId),
    code: (a, b) => a.code - b.code,
    tests: (a, b) => a.tests - b.tests,
    // Proportion, so a 1/1 requirement doesn't outrank a 6/8 one.
    criteria: (a, b) =>
      (a.criteriaCount ? a.criteriaWithTests / a.criteriaCount : 0) -
      (b.criteriaCount ? b.criteriaWithTests / b.criteriaCount : 0),
    state: (a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict],
    // Oldest drift first when ascending; clean rows sort last either way.
    drift: (a, b) => (a.driftAt ?? Infinity) - (b.driftAt ?? Infinity),
  };
  return rows.sort((a, b) => cmp[sort](a, b) * dir || a.specId.localeCompare(b.specId));
}

// @implements REQ-TVIZ-008
export function TraceabilityPage({ project }: PageProps) {
  const coverageQ = useApi(() => api.specCoverage(null, project), [project]);
  const specsQ = useApi(() => api.specs(project), [project]);
  const driftQ = useApi(() => api.drift(project), [project]);

  const [sort, setSort] = useState<SortKey>('spec');
  const [asc, setAsc] = useState(true);
  const [docFilter, setDocFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');

  // Requirement → its document's source path, via the parent document row.
  const docBySpec = useMemo(() => {
    const specs = specsQ.data?.specs ?? [];
    const byId = new Map(specs.map((s) => [s.id, s]));
    const m = new Map<string, string>();
    for (const s of specs) {
      if (s.kind !== 'requirement') continue;
      const parent = s.parentId ? byId.get(s.parentId) : undefined;
      m.set(s.id, (parent?.sourcePath ?? s.sourcePath ?? '—').replace(/^specs\//, ''));
    }
    return m;
  }, [specsQ.data]);

  // Newest drift timestamp per spec — the queue only carries unhealthy links,
  // which is exactly what "drift age" means here.
  const driftBySpec = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of driftQ.data?.links ?? []) {
      if (!l.updatedAt) continue;
      m.set(l.specId, Math.max(m.get(l.specId) ?? 0, l.updatedAt));
    }
    return m;
  }, [driftQ.data]);

  const rows = useMemo(
    () => buildRows(coverageQ.data?.requirements ?? [], docBySpec, driftBySpec, sort, asc),
    [coverageQ.data, docBySpec, driftBySpec, sort, asc],
  );

  const docs = useMemo(() => [...new Set(rows.map((r) => r.doc))].sort(), [rows]);
  const shown = rows.filter((r) =>
    (!docFilter || r.doc === docFilter) && (!stateFilter || r.verdict === stateFilter));

  if (isNoProject(coverageQ.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }
  // A server without the Wave 2 rollup can't back this page, and this page
  // must not invent a substitute (A2) — it says so instead.
  if (coverageQ.error) {
    return (
      <Empty
        icon="drift"
        title="Coverage endpoint unavailable"
        body="This view is backed by GET /api/spec/coverage, which this server didn’t answer. Update SpecShip and reload — the matrix will not guess at coverage from link states."
        action={
          <button className="btn btn-secondary btn-sm" onClick={coverageQ.reload}>
            <Icon name="refresh" size={13} />Retry
          </button>
        }
      />
    );
  }

  const totals = coverageQ.data?.totals;

  const th = (key: SortKey, label: string, width?: number, right?: boolean) => (
    <button
      onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(true); } }}
      className="row gap-4 eyebrow"
      aria-label={'Sort by ' + label}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        width, flex: width ? undefined : 1, justifyContent: right ? 'flex-end' : 'flex-start',
        color: sort === key ? 'var(--accent)' : undefined,
      }}
    >
      {label}
      {sort === key && <Icon name={asc ? 'chevronDown' : 'chevronRight'} size={10} />}
    </button>
  );

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <PageHead
          icon="matrix"
          title="Traceability"
          sub={coverageQ.data
            ? `${rows.length} requirements · ${totals?.criteriaWithTests ?? 0} of ${totals?.criteria ?? 0} criteria have a proving test`
            : 'Loading coverage…'}
        />
      </div>

      <div className="row gap-8" style={{ padding: '0 18px 12px', flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} style={{ color: 'var(--text-muted)' }} />
        <select
          className="input"
          aria-label="Filter by document"
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          style={{ height: 26, fontSize: 11.5 }}
        >
          <option value="">All documents</option>
          {docs.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          className="input"
          aria-label="Filter by state"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          style={{ height: 26, fontSize: 11.5 }}
        >
          <option value="">All states</option>
          {VERDICTS.map((v) => <option key={v} value={v}>{VERDICT[v].label}</option>)}
        </select>
        <span className="muted tabular" style={{ fontSize: 11 }}>{shown.length} shown</span>
      </div>

      <div className="row gap-10" style={{ padding: '6px 18px', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
        {th('spec', 'Requirement', 190)}
        {th('doc', 'Document', 150)}
        {th('code', 'Code', 54, true)}
        {th('tests', 'Tests', 54, true)}
        {th('criteria', 'Criteria', 74, true)}
        {th('state', 'State', 96)}
        {th('drift', 'Drift age', 70, true)}
      </div>

      {coverageQ.data && !rows.length ? (
        <Empty icon="book" title="No requirements indexed" body="Author a spec under specs/ and run a sync — the matrix fills from the coverage rollup." />
      ) : (
        <div className="scroll-y" style={{ flex: 1 }} role="table" aria-label="Traceability matrix">
          {shown.map((r) => {
            const v = VERDICT[r.verdict];
            const age = timeAgo(r.driftAt ?? undefined);
            return (
              <div
                key={r.specId}
                role="row"
                tabIndex={0}
                className="row gap-10 list-row"
                // Row click opens the requirement's detail (A3).
                onClick={() => go('specs', { query: { sel: r.specId } })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('specs', { query: { sel: r.specId } }); } }}
                style={{ padding: '9px 18px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
              >
                <div style={{ width: 190, flexShrink: 0, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--node-spec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.specId}</div>
                  <div className="muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                </div>
                <span className="mono muted" style={{ width: 150, flexShrink: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.doc}</span>
                <span
                  className="mono tabular"
                  title={r.code + ' code link(s)'}
                  style={{ width: 54, flexShrink: 0, textAlign: 'right', fontSize: 12, color: r.code ? 'var(--node-spec)' : 'var(--text-faint)' }}
                >
                  {r.code}
                </span>
                <span
                  className="mono tabular"
                  title={r.tests + ' proving test link(s)'}
                  style={{ width: 54, flexShrink: 0, textAlign: 'right', fontSize: 12, color: r.tests ? 'var(--success)' : 'var(--warn)' }}
                >
                  {r.tests}
                </span>
                <span
                  className="mono tabular muted"
                  title="Acceptance criteria with a proving test"
                  style={{ width: 74, flexShrink: 0, textAlign: 'right', fontSize: 12 }}
                >
                  {r.criteriaWithTests + ' / ' + r.criteriaCount}
                </span>
                <span style={{ width: 96, flexShrink: 0 }}>
                  <Pill color={v.color} bg={v.bg} dot>{v.label}</Pill>
                </span>
                <span
                  className="mono tabular"
                  title={age ? 'Oldest unhealthy link, last changed' : 'No drifted, broken, or orphaned link'}
                  style={{ width: 70, flexShrink: 0, textAlign: 'right', fontSize: 11, color: age ? STATE.drifted!.color : 'var(--text-faint)' }}
                >
                  {age ?? '—'}
                </span>
              </div>
            );
          })}
          {coverageQ.data && rows.length > 0 && !shown.length && (
            <div className="muted" style={{ padding: '18px', textAlign: 'center', fontSize: 12.5 }}>
              No requirement matches these filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

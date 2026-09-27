/**
 * Specs screen — document-grouped requirement tree + detail pane, ported from
 * the design bundle's Specs (specs/specship-desktop/screens-specs.jsx) onto
 * live /api/specs + /api/spec/:id data (REQ-DESKTOP-022).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, isNoProject, type RequirementCoverage, type SpecDoc, type SpecFunnelResponse } from '../api';
import { useApi } from '../hooks';
import { Icon } from '../components/icons';
import { SpecDetail, type SpecDetailCache } from '../components/spec-detail';
import { Empty, STATE } from '../components/ui';
import type { PageProps } from './types';

/** Enter/Space activate a focusable row, mirroring its click (REQ-DESKTOP-014.A1). */
function rowKey(activate: () => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
  };
}

export interface SpecGroup {
  doc: SpecDoc | null;
  path: string;
  reqs: SpecDoc[];
  /** Idea-stage briefs branch — rendered distinctly, never as a document. */
  ideas?: boolean;
}

/** The branch label for idea-stage briefs (REQ-TVIZ-007.A3). */
export const IDEAS_BRANCH = 'Ideas';

/**
 * Group the flat /api/specs list into document → requirements, keyed by
 * sourcePath. Requirements whose parent document isn't indexed still get a
 * group under their own sourcePath, so nothing silently drops from the tree.
 *
 * `brief`-kind specs are the funnel's idea stage: parentless, one per brief
 * file. They used to be dropped on the floor here; now they collect into a
 * single leading Ideas branch (REQ-TVIZ-007.A3).
 */
export function groupSpecs(specs: SpecDoc[]): SpecGroup[] {
  const groups = new Map<string, SpecGroup>();
  const byId = new Map(specs.map((s) => [s.id, s]));
  const groupFor = (path: string, doc: SpecDoc | null): SpecGroup => {
    let g = groups.get(path);
    if (!g) { g = { doc, path, reqs: [] }; groups.set(path, g); }
    if (doc && !g.doc) g.doc = doc;
    return g;
  };
  for (const s of specs) {
    if (s.kind === 'document') groupFor(s.sourcePath ?? s.id, s);
  }
  for (const s of specs) {
    if (s.kind !== 'requirement') continue;
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    const path = parent?.sourcePath ?? s.sourcePath ?? '(unknown)';
    groupFor(path, parent?.kind === 'document' ? parent : null).reqs.push(s);
  }
  const briefs = specs.filter((s) => s.kind === 'brief');
  const ordered = [...groups.values()];
  return briefs.length
    ? [{ doc: null, path: IDEAS_BRANCH, reqs: briefs, ideas: true }, ...ordered]
    : ordered;
}

const FILTER_STATES = ['verified', 'implemented', 'drifted', 'broken', 'orphaned'];

/** Drift states, worst first — drives document-row shading (REQ-TVIZ-010.A2). */
const DRIFT_ORDER = ['broken', 'orphaned', 'drifted'];

/**
 * Funnel stat tiles from GET /api/spec/funnel (REQ-TVIZ-007.A1, closing
 * REQ-DASHUX-003.A2). A failed funnel fetch renders nothing — the tree below
 * is the page's job, and a broken strip must not take it down.
 */
// @implements REQ-TVIZ-007
function FunnelTiles({ funnel }: { funnel: SpecFunnelResponse | null }) {
  if (!funnel) return null;
  const s = funnel.summary;
  const drift = s.links.drifted + s.links.broken + s.links.orphaned;
  const tiles: Array<{ label: string; value: number; color?: string }> = [
    { label: 'Ideas', value: s.ideas, color: 'var(--info)' },
    { label: 'Specified', value: s.specified },
    { label: 'Documents', value: s.documents },
    { label: 'Requirements', value: s.requirements },
    { label: 'Implemented', value: s.links.implemented, color: 'var(--node-spec)' },
    { label: 'Verified', value: s.links.verified, color: 'var(--success)' },
    { label: 'Drift', value: drift, color: drift ? 'var(--warn)' : 'var(--success)' },
  ];
  return (
    <div className="row gap-8" data-testid="funnel-tiles" style={{ padding: '12px 14px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }}>
      {tiles.map((t) => (
        <div
          key={t.label}
          className="card"
          title={t.label}
          style={{ padding: '7px 12px', minWidth: 92, background: 'var(--bg-panel)' }}
        >
          <div className="eyebrow">{t.label}</div>
          <div className="mono tabular" style={{ fontSize: 17, fontWeight: 600, color: t.color ?? 'var(--text-primary)' }}>{t.value}</div>
        </div>
      ))}
      {funnel.summary.conflicts > 0 && (
        <div className="row gap-6" style={{ color: 'var(--warn)', fontSize: 11.5, alignSelf: 'center' }}>
          <Icon name="drift" size={13} />
          {funnel.summary.conflicts} brief/spec conflict{funnel.summary.conflicts === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

/** Compact code/test/criteria indicators for one requirement (REQ-TVIZ-007.A2). */
function CoverageChips({ cov }: { cov: RequirementCoverage | undefined }) {
  if (!cov) return null;
  const tests = cov.testsLinks.count;
  return (
    <span className="row gap-4 mono tabular" data-testid="coverage-chips" style={{ fontSize: 9.5, flexShrink: 0 }}>
      <span title={cov.implementsLinks.count + ' code link(s)'} style={{ color: cov.implementsLinks.count ? 'var(--node-spec)' : 'var(--text-faint)' }}>
        {cov.implementsLinks.count}c
      </span>
      <span title={tests + ' proving test link(s)'} style={{ color: tests ? 'var(--success)' : 'var(--warn)' }}>
        {tests}t
      </span>
      <span title="Acceptance criteria with a proving test" style={{ color: 'var(--text-muted)' }}>
        {cov.criteriaWithTests + '/' + cov.criteriaCount}
      </span>
    </span>
  );
}

// @implements REQ-DESKTOP-022
export function SpecsPage({ project, param, query }: PageProps) {
  const specsQ = useApi(() => api.specs(project), [project]);
  const funnelQ = useApi(() => api.specFunnel(project), [project]);
  // The Wave 2 rollup is the single source of coverage truth (REQ-TVIZ-008.A2);
  // an older server without the route just leaves the chips off.
  const coverageQ = useApi(() => api.specCoverage(null, project), [project]);
  // Selection is seeded from the route (`/specs/REQ-…` via the palette, or
  // `?sel=` via the drift queue's Open spec) and lives independently of the
  // filtered tree — filters hide rows, they never clear the selection (A2).
  const [sel, setSel] = useState<string | null>(param ?? query.sel ?? null);
  useEffect(() => {
    const target = param ?? query.sel;
    if (target) setSel(target);
  }, [param, query.sel]);
  const [off, setOff] = useState<Set<string>>(new Set());
  // Details viewed this mount — re-selection swaps in instantly (016.A1).
  const detailCache = useRef<SpecDetailCache>(new Map()).current;

  const groups = useMemo(() => groupSpecs(specsQ.data?.specs ?? []), [specsQ.data]);
  const linkStates = specsQ.data?.linkStates ?? {};
  const coverage = useMemo(
    () => new Map((coverageQ.data?.requirements ?? []).map((r) => [r.specId, r])),
    [coverageQ.data],
  );

  if (isNoProject(specsQ.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const totalReqs = groups.reduce((n, g) => n + g.reqs.length, 0);
  const counts: Record<string, number> = {};
  for (const g of groups) {
    for (const r of g.reqs) {
      const st = linkStates[r.id];
      if (st) counts[st] = (counts[st] ?? 0) + 1;
    }
  }
  // A row with no link state (drafted / not yet linked) always shows; a row
  // with a state shows while its chip is on.
  const hidden = (r: SpecDoc) => {
    const st = linkStates[r.id];
    return !!st && off.has(st);
  };
  const toggle = (s: string) =>
    setOff((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s); else n.add(s);
      return n;
    });

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <FunnelTiles funnel={funnelQ.data} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div className="col" style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>
        <div className="row" style={{ gap: 8, padding: '11px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="book" size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Specs</span>
          <span className="grow" />
          <span className="muted tabular" style={{ fontSize: 11 }}>
            {specsQ.data ? totalReqs + ' reqs' : '…'}
          </span>
        </div>
        <div className="row" style={{ gap: 5, padding: '8px 10px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="filter" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          {FILTER_STATES.map((s) => {
            const on = !off.has(s);
            const st = STATE[s]!;
            return (
              <button
                key={s}
                onClick={() => toggle(s)}
                className="row gap-4"
                style={{
                  height: 22, padding: '0 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 500,
                  cursor: 'pointer', textTransform: 'capitalize',
                  border: '1px solid ' + (on ? 'transparent' : 'var(--border-subtle)'),
                  background: on ? st.bg : 'var(--bg-panel)',
                  color: on ? st.color : 'var(--text-muted)',
                }}
              >
                {s}
                <span className="tabular" style={{ opacity: 0.7 }}>{counts[s] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="scroll-y" style={{ flex: 1, padding: 6 }} role={groups.length ? 'tree' : undefined} aria-label={groups.length ? 'Spec tree' : undefined}>
          {specsQ.data && !groups.length && (
            <Empty icon="book" title="No specs yet" body="Author one with the spec-author skill — specs/*.md index on sync." />
          )}
          {groups.map((g) => (
            <SpecTreeRow key={g.path} group={g} linkStates={linkStates} coverage={coverage} selId={sel} hidden={hidden} onSel={setSel} />
          ))}
        </div>
      </div>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <SpecDetail key={sel ?? ''} id={sel} project={project} cache={detailCache} />
      </div>
      </div>
    </div>
  );
}

// @implements REQ-DESKTOP-013
// @implements REQ-TVIZ-007
// @implements REQ-TVIZ-010
function SpecTreeRow({ group, linkStates, coverage, selId, hidden, onSel }: {
  group: SpecGroup;
  linkStates: Record<string, string>;
  coverage: Map<string, RequirementCoverage>;
  selId: string | null;
  hidden: (r: SpecDoc) => boolean;
  onSel: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const reqs = group.reqs.filter((r) => !hidden(r));
  const driftCount = group.reqs.filter((r) => ['drifted', 'broken', 'orphaned'].includes(linkStates[r.id] ?? '')).length;
  // Worst drift state across the document's requirements shades the row, so a
  // collapsed branch still reads as hot (REQ-TVIZ-010.A2).
  const worstDrift = DRIFT_ORDER.find((s) => group.reqs.some((r) => linkStates[r.id] === s)) ?? null;
  // Document-level coverage rollup (REQ-TVIZ-007.A2).
  const covRows = group.reqs.map((r) => coverage.get(r.id)).filter((c): c is RequirementCoverage => !!c);
  const docRollup = covRows.length
    ? {
      code: covRows.reduce((n, c) => n + c.implementsLinks.count, 0),
      tests: covRows.reduce((n, c) => n + c.testsLinks.count, 0),
      withTests: covRows.reduce((n, c) => n + c.criteriaWithTests, 0),
      criteria: covRows.reduce((n, c) => n + c.criteriaCount, 0),
    }
    : null;

  if (group.ideas) {
    return (
      <IdeasBranch group={group} reqs={reqs} selId={selId} onSel={onSel} />
    );
  }

  return (
    <div>
      {/* Rows take hover/pressed/selected from the shared .list-row states
          (REQ-DESKTOP-013.A1) and are keyboard-operable (014.A1/013.A4). */}
      <div
        onClick={() => setOpen(!open)}
        onKeyDown={rowKey(() => setOpen(!open))}
        role="treeitem"
        aria-expanded={open}
        tabIndex={0}
        className="row gap-6 list-row"
        data-drift={worstDrift ?? undefined}
        title={worstDrift ? `Worst link state in this document: ${worstDrift}` : undefined}
        style={{
          padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)',
          background: worstDrift ? (STATE[worstDrift]!.bg) : undefined,
        }}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} style={{ color: 'var(--text-muted)' }} />
        <Icon name="book" size={13} style={{ color: worstDrift ? STATE[worstDrift]!.color : 'var(--node-spec)' }} />
        <span className="mono grow" style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.path.replace(/^specs\//, '')}
        </span>
        {docRollup && (
          <span
            className="mono tabular"
            data-testid="doc-rollup"
            title={`${docRollup.code} code links · ${docRollup.tests} test links · ${docRollup.withTests} of ${docRollup.criteria} criteria have a proving test`}
            style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}
          >
            {docRollup.code + 'c ' + docRollup.tests + 't ' + docRollup.withTests + '/' + docRollup.criteria}
          </span>
        )}
        {driftCount > 0 && (
          <span className="pill" style={{ fontSize: 9.5, color: 'var(--warn)', background: 'var(--warn-soft)' }}>{driftCount}</span>
        )}
      </div>
      {open && reqs.length > 0 && (
        <div role="group" style={{ marginLeft: 14, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 6 }}>
          {reqs.map((r) => {
            const active = selId === r.id;
            const st = STATE[linkStates[r.id] ?? ''] ?? STATE.drafted!;
            return (
              <div
                key={r.id}
                onClick={() => onSel(r.id)}
                onKeyDown={rowKey(() => onSel(r.id))}
                role="treeitem"
                aria-selected={active}
                tabIndex={0}
                className={'row gap-6 list-row' + (active ? ' selected' : '')}
                style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer' }}
              >
                <span className="pill-dot" style={{ background: st.color, flexShrink: 0 }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.id}</div>
                  <div className="muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                </div>
                <CoverageChips cov={coverage.get(r.id)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The idea-stage branch: brief specs, visibly distinct from requirement
 * documents (REQ-TVIZ-007.A3 / REQ-FUNNEL-006.A2-A3). They carry no link
 * state and no criteria, so the row shows the brief's title, not a state dot.
 */
function IdeasBranch({ group, reqs, selId, onSel }: {
  group: SpecGroup;
  reqs: SpecDoc[];
  selId: string | null;
  onSel: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid="ideas-branch">
      <div
        onClick={() => setOpen(!open)}
        onKeyDown={rowKey(() => setOpen(!open))}
        role="treeitem"
        aria-expanded={open}
        tabIndex={0}
        className="row gap-6 list-row"
        style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--info)', background: 'var(--info-soft)' }}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} style={{ color: 'var(--info)' }} />
        <Icon name="sparkles" size={13} style={{ color: 'var(--info)' }} />
        <span className="grow" style={{ fontSize: 12, fontWeight: 600 }}>{group.path}</span>
        <span className="pill tabular" style={{ fontSize: 9.5, color: 'var(--info)', background: 'var(--info-soft)' }}>{group.reqs.length}</span>
      </div>
      {open && reqs.length > 0 && (
        <div role="group" style={{ marginLeft: 14, borderLeft: '1px solid var(--info-soft)', paddingLeft: 6 }}>
          {reqs.map((b) => {
            const active = selId === b.id;
            const specified = typeof b.metadata?.spec === 'string';
            return (
              <div
                key={b.id}
                onClick={() => onSel(b.id)}
                onKeyDown={rowKey(() => onSel(b.id))}
                role="treeitem"
                aria-selected={active}
                tabIndex={0}
                className={'row gap-6 list-row' + (active ? ' selected' : '')}
                style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer' }}
              >
                <span className="pill-dot" style={{ background: specified ? 'var(--node-spec)' : 'var(--info)', flexShrink: 0 }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                  <div className="mono muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.id}</div>
                </div>
                {specified && (
                  <span className="pill" title="Already specified" style={{ fontSize: 9, color: 'var(--node-spec)', background: 'var(--node-spec-soft)', flexShrink: 0 }}>spec’d</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Specs screen — document-grouped requirement tree + detail pane, ported from
 * the design bundle's Specs (specs/specship-desktop/screens-specs.jsx) onto
 * live /api/specs + /api/spec/:id data (REQ-DESKTOP-022).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, isNoProject, type SpecDoc } from '../api';
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
}

/**
 * Group the flat /api/specs list into document → requirements, keyed by
 * sourcePath. Requirements whose parent document isn't indexed still get a
 * group under their own sourcePath, so nothing silently drops from the tree.
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
  return [...groups.values()];
}

const FILTER_STATES = ['verified', 'implemented', 'drifted', 'broken', 'orphaned'];

// @implements REQ-DESKTOP-022
export function SpecsPage({ project, param, query }: PageProps) {
  const specsQ = useApi(() => api.specs(project), [project]);
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
            <SpecTreeRow key={g.path} group={g} linkStates={linkStates} selId={sel} hidden={hidden} onSel={setSel} />
          ))}
        </div>
      </div>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <SpecDetail key={sel ?? ''} id={sel} project={project} cache={detailCache} />
      </div>
    </div>
  );
}

// @implements REQ-DESKTOP-013
function SpecTreeRow({ group, linkStates, selId, hidden, onSel }: {
  group: SpecGroup;
  linkStates: Record<string, string>;
  selId: string | null;
  hidden: (r: SpecDoc) => boolean;
  onSel: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const reqs = group.reqs.filter((r) => !hidden(r));
  const driftCount = group.reqs.filter((r) => ['drifted', 'broken', 'orphaned'].includes(linkStates[r.id] ?? '')).length;
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
        style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} style={{ color: 'var(--text-muted)' }} />
        <Icon name="book" size={13} style={{ color: 'var(--node-spec)' }} />
        <span className="mono grow" style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.path.replace(/^specs\//, '')}
        </span>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

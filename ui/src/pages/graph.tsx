/**
 * Graph screen — the live knowledge-graph canvas with a layout/filter toolbar
 * and the 360px selection detail rail. Pixel contract:
 * specs/specship-desktop/screens-graph.jsx.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { GraphCanvas, forceLayout, hierarchicalLayout, type CanvasEdge } from '../components/graph';
import { GraphDetailRail, GraphOverviewRail } from '../components/graph-rail';
import { Icon } from '../components/icons';
import { Empty, Segmented, nodeColor } from '../components/ui';
import type { PageProps } from './types';

/** Toolbar filter chip (design bundle's Chip). */
function Chip({ label, count, active, onClick, color }: {
  label: string; count?: number; active: boolean; onClick: () => void; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="row gap-6"
      style={{
        height: 26, padding: '0 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
        border: '1px solid ' + (active ? 'transparent' : 'var(--border-subtle)'),
        background: active ? (color ? `color-mix(in srgb, ${color} 22%, var(--bg-panel))` : 'var(--accent-soft)') : 'var(--bg-panel)',
        color: active ? (color || 'var(--accent)') : 'var(--text-secondary)', transition: 'all 100ms',
      }}
    >
      {color && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
      {label}
      {count != null && <span className="tabular muted" style={{ fontSize: 10.5 }}>{count}</span>}
    </button>
  );
}

const KIND_CHIPS = [
  { kind: 'code', label: 'Code' }, { kind: 'spec', label: 'Spec' },
  { kind: 'test', label: 'Test' }, { kind: 'route', label: 'Route' },
];

const EDGE_CHIPS = [
  { key: 'calls', label: 'calls' },
  { key: 'implements', label: 'implements' },
  { key: 'tests', label: 'tests' },
  { key: 'synth', label: 'synth' },
];

// @implements REQ-DESKTOP-021
export function GraphPage({ project, query }: PageProps) {
  const graph = useApi(() => api.graphFull(project), [project]);
  // `?focus=<nodeId>` deep-links a selection — the ⌘K palette, Show in graph,
  // and Reveal all land here; the canvas centers via its focusId prop (A3).
  const focus = query.focus ?? null;
  const [selected, setSelected] = useState<string | null>(focus);
  const [mode, setMode] = useState('hierarchical');
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [hiddenEdgeKinds, setHiddenEdgeKinds] = useState<Set<string>>(new Set());
  const [fitKey, setFitKey] = useState(0);

  useEffect(() => { if (focus) setSelected(focus); }, [focus]);

  // Hubs first so the densest nodes anchor the layout.
  const ordered = useMemo(
    () => [...(graph.data?.nodes ?? [])].sort((a, b) => b.degree - a.degree),
    [graph.data],
  );
  const edges: CanvasEdge[] = useMemo(
    () => (graph.data?.edges ?? []).map((e) => ({ from: e.from, to: e.to, kind: e.provenance === 'heuristic' ? 'synth' : e.kind })),
    [graph.data],
  );
  // Layout and filter toggles only recompute memos — never a refetch (A1).
  const nodes = useMemo(
    () => (mode === 'force' ? forceLayout(ordered, edges) : hierarchicalLayout(ordered, edges)),
    [ordered, edges, mode],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    nodes.forEach((n) => { c[n.kind] = (c[n.kind] ?? 0) + 1; });
    return c;
  }, [nodes]);
  const hiddenIds = useMemo(() => {
    const h = new Set<string>();
    if (hiddenKinds.size) nodes.forEach((n) => { if (hiddenKinds.has(n.kind)) h.add(n.id); });
    return h;
  }, [nodes, hiddenKinds]);

  const toggleIn = (set: Set<string>, key: string, put: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    put(next);
  };

  if (isNoProject(graph.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="col" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* toolbar */}
        <div className="row" style={{ gap: 10, padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-panel-2)', flexWrap: 'wrap' }}>
          <Segmented
            size="sm"
            value={mode}
            onChange={(v) => { setMode(v); setFitKey((k) => k + 1); }}
            options={[{ value: 'hierarchical', label: 'Hierarchical' }, { value: 'force', label: 'Force' }]}
          />
          <div style={{ width: 1, height: 20, background: 'var(--border-subtle)' }} />
          {KIND_CHIPS.filter((k) => counts[k.kind]).map((k) => (
            <Chip
              key={k.kind}
              label={k.label}
              count={counts[k.kind]}
              color={nodeColor(k.kind)}
              active={!hiddenKinds.has(k.kind)}
              onClick={() => toggleIn(hiddenKinds, k.kind, setHiddenKinds)}
            />
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--border-subtle)' }} />
          {EDGE_CHIPS.map((b) => (
            <Chip
              key={b.key}
              label={b.label}
              active={!hiddenEdgeKinds.has(b.key)}
              onClick={() => toggleIn(hiddenEdgeKinds, b.key, setHiddenEdgeKinds)}
            />
          ))}
          <div className="grow" />
          <button className="btn btn-secondary btn-sm" onClick={() => setFitKey((k) => k + 1)}>
            <Icon name="recenter" size={13} />
            Recenter
          </button>
        </div>
        {/* canvas */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {nodes.length > 0 && (
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              selectedId={selected}
              onSelect={setSelected}
              hiddenIds={hiddenIds}
              hiddenEdgeKinds={hiddenEdgeKinds}
              fitKey={fitKey}
              focusId={focus}
            />
          )}
          {graph.data && !nodes.length && (
            <Empty icon="graph" title="Nothing indexed yet" body="Run specship index to populate the graph." />
          )}
        </div>
      </div>
      {/* right rail */}
      <div style={{ width: 360, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-panel)', minHeight: 0 }}>
        {selected ? (
          <GraphDetailRail id={selected} project={project} onSelect={setSelected} onClose={() => setSelected(null)} />
        ) : (
          <GraphOverviewRail project={project} counts={counts} shown={graph.data?.shown ?? 0} onSelect={setSelected} />
        )}
      </div>
    </div>
  );
}

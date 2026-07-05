import { useMemo, useState } from 'react';
import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { GraphCanvas, type CanvasEdge, type CanvasNode } from '../components/graph';
import { Empty, PageHead, Pill, nodeColor } from '../components/ui';
import type { PageProps } from './types';

/** Map server node kinds onto the canvas's visual families. */
function visualKind(kind: string, filePath: string): string {
  if (kind === 'route') return 'route';
  if (/\.(test|spec)\.|__tests__\//.test(filePath)) return 'test';
  return 'code';
}

/**
 * Deterministic golden-angle spiral layout, hubs (highest degree) in the
 * center. Server nodes carry no coordinates; a physics layout is later
 * screens' work — the spiral keeps this screen stable across reloads.
 */
function layout(nodes: { id: string; name: string; kind: string; filePath: string; degree: number }[]): CanvasNode[] {
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
  return sorted.map((n, i) => {
    const r = 46 * Math.sqrt(i + 0.6);
    const th = i * 2.399963229728653;
    return {
      id: n.id,
      label: n.name,
      kind: visualKind(n.kind, n.filePath),
      x: Math.round(r * Math.cos(th) * 2.2),
      y: Math.round(r * Math.sin(th)),
      file: n.filePath,
    };
  });
}

export function GraphPage({ project }: PageProps) {
  const graph = useApi(() => api.graphFull(project), [project]);
  const [selected, setSelected] = useState<string | null>(null);

  const nodes = useMemo(() => layout(graph.data?.nodes ?? []), [graph.data]);
  const edges: CanvasEdge[] = useMemo(
    () => (graph.data?.edges ?? []).map((e) => ({ from: e.from, to: e.to, kind: e.provenance === 'heuristic' ? 'synth' : e.kind })),
    [graph.data],
  );

  if (isNoProject(graph.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const sel = selected ? graph.data?.nodes.find((n) => n.id === selected) : undefined;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ padding: '14px 22px 10px' }}>
        <PageHead
          icon="graph"
          title="Graph"
          sub={graph.data ? `${graph.data.shown.toLocaleString()} highest-degree of ${graph.data.total.toLocaleString()} nodes` : 'Loading graph…'}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {nodes.length > 0 && <GraphCanvas nodes={nodes} edges={edges} selectedId={selected} onSelect={setSelected} />}
        {graph.data && !nodes.length && <Empty icon="graph" title="Nothing indexed yet" body="Run specship index to populate the graph." />}
        {sel && (
          <div className="card card-pad" style={{ position: 'absolute', top: 12, right: 12, maxWidth: 320, boxShadow: 'var(--shadow-pop)' }}>
            <div className="row gap-8" style={{ marginBottom: 6 }}>
              <span className="pill-dot" style={{ background: nodeColor(visualKind(sel.kind, sel.filePath)), width: 8, height: 8, borderRadius: '50%' }} />
              <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{sel.name}</span>
              <Pill>{sel.kind}</Pill>
            </div>
            <div className="mono muted" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{sel.filePath}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{sel.degree} connections</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Graph screen right rail — overview when nothing is selected, node detail on
 * selection. TSX port of the design bundle's screens-graph.jsx panels
 * (OverviewPanel / DetailPanel), fed by /api/graph/health and /api/graph/node
 * instead of mock DATA (REQ-DESKTOP-021).
 */
import type { CSSProperties, ReactNode } from 'react';
import { api, type GraphNode, type NodeRef } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from './icons';
import { CopyBtn, Pill, StatePill, nodeColor } from './ui';
import { visualKind } from './graph';

const railCol: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column' };
const railHead: CSSProperties = { gap: 8, padding: '13px 14px', borderBottom: '1px solid var(--border-subtle)' };
const railBody: CSSProperties = { flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 16 };
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Rail list row — interactive ones take the shared .list-row states
 * (REQ-DESKTOP-013) and are keyboard-operable (014.A1/013.A4). */
function HoverRow({ onClick, children, bordered }: { onClick?: () => void; children: ReactNode; bordered?: boolean }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={'row gap-8' + (onClick ? ' list-row' : '')}
      style={{
        padding: bordered ? '6px 8px' : '5px 8px', borderRadius: 6, cursor: onClick ? 'pointer' : 'default',
        fontSize: 12, border: bordered ? '1px solid var(--border-subtle)' : 'none', marginBottom: bordered ? 5 : 0,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow" style={{ marginBottom: 6 }}>{children}</div>;
}

/** Hub / anchored row: kind dot, name, degree, chevron. */
function NodeRow({ n, onSelect }: { n: GraphNode; onSelect: (id: string) => void }) {
  const vk = visualKind(n.kind, n.filePath);
  return (
    <HoverRow onClick={() => onSelect(n.id)}>
      <span style={{ width: 7, height: 7, borderRadius: vk === 'spec' ? 2 : '50%', background: nodeColor(vk), flexShrink: 0 }} />
      <span className="mono grow" style={{ fontSize: 12, ...ellipsis }}>{n.name}</span>
      <span className="mono tabular muted" style={{ fontSize: 10.5 }}>{n.degree} edges</span>
      <Icon name="chevronRight" size={12} style={{ color: 'var(--text-faint)' }} />
    </HoverRow>
  );
}

function EdgeLegendRow({ color, label, count, dashed }: { color: string; label: string; count?: number; dashed?: boolean }) {
  return (
    <div className="row gap-8" style={{ padding: '4px 0' }}>
      <svg width={20} height={8} style={{ flexShrink: 0 }}>
        <line x1={0} y1={4} x2={20} y2={4} stroke={color} strokeWidth={1.8} strokeDasharray={dashed ? '4 3' : 'none'} />
      </svg>
      <span className="grow secondary" style={{ fontSize: 12 }}>{label}</span>
      {count != null && <span className="mono tabular muted" style={{ fontSize: 11 }}>{count}</span>}
    </div>
  );
}

const KIND_ROWS: Array<{ kind: string; label: string }> = [
  { kind: 'code', label: 'Code' }, { kind: 'spec', label: 'Spec' },
  { kind: 'test', label: 'Test' }, { kind: 'route', label: 'Route' },
];

/** Spec-link states the health section surfaces; broken folds in orphaned. */
const HEALTH_STATES = ['verified', 'drifted', 'broken'] as const;

export function GraphOverviewRail({ project, counts, shown, onSelect }: {
  project: string | null;
  counts: Record<string, number>;
  shown: number;
  onSelect: (id: string) => void;
}) {
  const health = useApi(() => api.graphHealth(project), [project]);
  const linkHealth = health.data?.linkHealth ?? {};
  const edgeKinds = health.data?.edgeKinds ?? {};
  const healthCounts: Record<string, number> = {
    verified: linkHealth.verified ?? 0,
    drifted: linkHealth.drifted ?? 0,
    broken: (linkHealth.broken ?? 0) + (linkHealth.orphaned ?? 0),
  };
  const anyLinks = HEALTH_STATES.some((s) => healthCounts[s]! > 0);

  return (
    <div style={railCol}>
      <div className="row" style={railHead}>
        <Icon name="graph" size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Graph overview</span>
        <span className="grow" />
        <span className="mono muted" style={{ fontSize: 11 }}>{shown} shown</span>
      </div>
      <div className="scroll-y" style={railBody}>
        <div className="secondary" style={{ fontSize: 12, lineHeight: 1.55 }}>
          Click any node to inspect its signature, links, callers and callees — without leaving this view.
        </div>
        <div>
          <Eyebrow>Nodes by kind</Eyebrow>
          {KIND_ROWS.filter((k) => counts[k.kind]).map((k) => (
            <div key={k.kind} className="row gap-8" style={{ padding: '5px 0' }}>
              <span style={{ width: 9, height: 9, borderRadius: k.kind === 'spec' ? 2 : '50%', background: nodeColor(k.kind), flexShrink: 0, boxShadow: `0 0 6px ${nodeColor(k.kind)}` }} />
              <span className="grow" style={{ fontSize: 12.5 }}>{k.label}</span>
              <span className="mono tabular" style={{ fontSize: 12.5, fontWeight: 600 }}>{counts[k.kind]}</span>
            </div>
          ))}
        </div>
        <div>
          <Eyebrow>Spec link health</Eyebrow>
          {anyLinks ? (
            <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
              {HEALTH_STATES.filter((s) => healthCounts[s]! > 0).map((s) => (
                <span key={s} className="row gap-6">
                  <StatePill state={s} />
                  <span className="mono tabular muted" style={{ fontSize: 11, alignSelf: 'center' }}>{healthCounts[s]}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>No spec links yet</div>
          )}
        </div>
        <div>
          <Eyebrow>Edge types</Eyebrow>
          <EdgeLegendRow color="var(--text-muted)" label="calls" count={edgeKinds.calls ?? 0} />
          <EdgeLegendRow color="var(--node-spec)" label="implements / documents" count={edgeKinds.implements ?? 0} />
          <EdgeLegendRow color="var(--node-test)" label="tests" count={edgeKinds.tests ?? 0} />
          <EdgeLegendRow color="var(--text-muted)" label="synthesized (heuristic)" count={edgeKinds.synth ?? 0} dashed />
        </div>
        <div>
          <Eyebrow>Most connected</Eyebrow>
          {(health.data?.hubs ?? []).map((n) => <NodeRow key={n.id} n={n} onSelect={onSelect} />)}
          {health.data && !health.data.hubs.length && <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>No connected nodes yet</div>}
        </div>
        <div>
          <Eyebrow>Anchored</Eyebrow>
          {(health.data?.anchored ?? []).map((n) => <NodeRow key={n.id} n={n} onSelect={onSelect} />)}
          {health.data && !health.data.anchored.length && <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>No spec-linked code yet</div>}
        </div>
      </div>
    </div>
  );
}

function ListBlock({ title, items, empty, onSelect }: {
  title: string;
  items: NodeRef[];
  empty: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>
        {title}
        <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>{items.length}</span>
      </div>
      {items.length ? items.slice(0, 10).map((n) => (
        <HoverRow key={n.id} onClick={() => onSelect(n.id)}>
          <Icon name="box" size={12} style={{ color: nodeColor(visualKind(n.kind, n.filePath)), flexShrink: 0 }} />
          <span className="mono grow" style={ellipsis}>{n.name}</span>
          <span className="mono muted" style={{ fontSize: 10, flexShrink: 0 }}>{n.filePath.split('/').pop()}</span>
        </HoverRow>
      )) : (
        <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>{empty}</div>
      )}
    </div>
  );
}

export function GraphDetailRail({ id, project, onSelect, onClose }: {
  id: string;
  project: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const detail = useApi(() => api.graphNode(id, project), [id, project]);
  const node = detail.data?.matches[0];

  if (!node) {
    return (
      <div style={railCol}>
        <div className="row" style={railHead}>
          <span className="grow" style={{ fontWeight: 600, fontSize: 13.5 }}>Node</span>
          <button className="btn btn-ghost btn-xs" aria-label="Close node detail" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="muted" style={{ padding: 14, fontSize: 12 }}>
          {detail.loading ? 'Loading node…' : 'Node not found — it may have been re-indexed away.'}
        </div>
      </div>
    );
  }

  const vk = visualKind(node.kind, node.filePath);
  const isSpec = vk === 'spec' || node.kind === 'spec';
  const col = nodeColor(vk);

  return (
    <div style={railCol}>
      <div className="row" style={{ ...railHead, padding: '12px 14px' }}>
        <span style={{ width: 9, height: 9, borderRadius: isSpec ? 2 : '50%', background: col, flexShrink: 0, marginTop: 5, boxShadow: `0 0 8px ${col}`, alignSelf: 'flex-start' }} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, ...ellipsis }}>{node.name}</div>
          <div className="row gap-6" style={{ marginTop: 3 }}>
            <Pill color={col} bg={`color-mix(in srgb, ${col} 14%, transparent)`}>{node.kind}</Pill>
          </div>
        </div>
        <button className="btn btn-ghost btn-xs" aria-label="Close node detail" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>

      <div className="scroll-y" style={railBody}>
        <div className="row gap-6" style={{ fontSize: 11.5 }}>
          <Icon name="folder" size={12} style={{ color: 'var(--text-muted)' }} />
          <span className="mono secondary" style={ellipsis}>{node.filePath}</span>
          <CopyBtn text={node.filePath} ariaLabel="Copy file path" />
        </div>

        {!isSpec && node.signature && (
          <div>
            <Eyebrow>Signature</Eyebrow>
            <pre className="mono" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-secondary)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: 10, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
              {node.signature}
            </pre>
          </div>
        )}

        {!isSpec && (
          <div>
            <Eyebrow>Linked specs</Eyebrow>
            {node.linkedSpecs.length ? node.linkedSpecs.map((l, i) => (
              <HoverRow key={i} bordered onClick={() => go('specs', { param: l.specId })}>
                <span className="mono grow" style={{ fontSize: 11.5, ...ellipsis }}>{l.specId}</span>
                <StatePill state={l.state} />
              </HoverRow>
            )) : (
              <div className="muted" style={{ fontSize: 12, padding: '4px 8px' }}>No linked specs</div>
            )}
          </div>
        )}

        {!isSpec && <ListBlock title="Callers" items={node.callers} empty="No callers" onSelect={onSelect} />}
        {!isSpec && <ListBlock title="Callees" items={node.callees} empty="No callees" onSelect={onSelect} />}

        {isSpec && (
          <div>
            <Eyebrow>Linked code</Eyebrow>
            {node.linkedSpecs.length ? node.linkedSpecs.map((l, i) => (
              <HoverRow key={i} bordered>
                <StatePill state={l.state} />
                <span className="mono grow" style={{ fontSize: 11, ...ellipsis }}>{l.targetQualifiedName ?? l.targetFilePath}</span>
              </HoverRow>
            )) : (
              <div className="muted" style={{ fontSize: 12, padding: 8, border: '1px dashed var(--border-subtle)', borderRadius: 6, textAlign: 'center' }}>
                No linked code — orphaned
              </div>
            )}
          </div>
        )}
      </div>

      {/* Implement is workflow-owned: disabled treatment + owning-workflow
          tooltip; pointer/keyboard both no-op (REQ-DESKTOP-005.A1). */}
      <div className="row gap-8" style={{ padding: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <button
          className="btn btn-primary btn-sm grow"
          style={{ justifyContent: 'center' }}
          disabled
          title="Run automatically by the implementation workflow once Drafted"
        >
          <Icon name="play" size={13} />
          Implement
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => go('drift')}>View drift</button>
      </div>
    </div>
  );
}

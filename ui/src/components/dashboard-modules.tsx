/**
 * Dashboard overview modules (REQ-DESKTOP-020). TSX port of the design
 * bundle's screens-dashboard.jsx module set, bound to live /api data: stat
 * tiles, recent neighborhood, tips rail, tool-call heatstrip, recent prompts,
 * cache analytics. `Module` gives every card the shared loading / error /
 * retry treatment (REQ-DESKTOP-012 generalized by REQ-DESKTOP-030), and
 * `NeedsIngest` is the A4 "no transcript data" guidance the cost-fed modules
 * render instead of presenting zeros as truth.
 */
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import {
  api,
  type ClaudeCacheResponse,
  type ClaudeTip,
  type CostPrompt,
  type GraphFullResponse,
  type HeatmapFile,
} from '../api';
import type { ApiState } from '../hooks';
import { go } from '../router';
import { Sparkline, Treemap } from './charts';
import { GraphCanvas, spiralLayout, type CanvasEdge, type CanvasNode } from './graph';
import { Icon } from './icons';
import { Bar, Delta } from './ui';

/** Token-count formatter shared by the analytics modules (design's fmtK). */
export const fmtTok = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

/** Last two path segments — heatmap paths are absolute, cells are small. */
const shortPath = (p: string): string => p.split('/').filter(Boolean).slice(-2).join('/');

/** Prompt text arrives with <command-name>… wrappers; show the words only. */
const cleanText = (t: string): string => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ---- Shared module chrome ----

/**
 * Loading / error-with-retry wrapper around one dashboard card. While the
 * first fetch is in flight it renders a skeleton sized like the module; a
 * failed fetch renders the shared error state with a Retry wired to the
 * ApiState's reload. Data renders through the children function.
 */
export function Module<T>({ state, label, minHeight, children }: {
  state: ApiState<T>;
  label: string;
  minHeight: number;
  children: (data: T) => ReactNode;
}) {
  if (state.data == null && state.loading) {
    return <div className="skel" style={{ minHeight, borderRadius: 10 }} aria-label={`Loading ${label}`} />;
  }
  if (state.data == null && state.error != null) {
    const msg = state.error instanceof Error ? state.error.message : String(state.error);
    return (
      <div className="card card-pad" style={{ minHeight, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 300 }}>
          <div className="row gap-8" style={{ justifyContent: 'center', color: 'var(--error)' }}>
            <Icon name="cancel" size={14} />
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Couldn't load {label}</span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4, overflowWrap: 'anywhere' }}>{msg}</div>
          <button className="btn btn-secondary btn-xs" style={{ marginTop: 10 }} onClick={state.reload}>Retry</button>
        </div>
      </div>
    );
  }
  if (state.data == null) return null;
  return <>{children(state.data)}</>;
}

/**
 * A4 guidance: zero ingested sessions means the cost modules have no truth to
 * show. Point at the ingest path instead of rendering $0s. The button forces
 * a one-shot ingest pass (the status strip's Refresh does the same).
 */
export function NeedsIngest({ onIngested }: { onIngested?: () => void }) {
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    api.ingestNow()
      .catch(() => undefined)
      .finally(() => { setRunning(false); onIngested?.(); });
  };
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 18, textAlign: 'center' }}>
      <div style={{ maxWidth: 320 }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}><Icon name="database" size={18} /></div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>No Claude Code data ingested yet</div>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          Usage modules light up once SpecShip ingests your transcripts from ~/.claude/projects — run an ingest pass now, or use Refresh in the status strip.
        </div>
        <button className="btn btn-secondary btn-xs" style={{ marginTop: 10 }} onClick={run} disabled={running}>
          {running ? 'Ingesting…' : 'Run ingest now'}
        </button>
      </div>
    </div>
  );
}

/** Header link that navigates to another screen (REQ-DESKTOP-020.A3). */
export function CrossLink({ label, page, arrow }: { label: string; page: string; arrow?: boolean }) {
  return (
    <a
      href={'/' + page}
      className="btn btn-ghost btn-xs"
      onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return; // keep open-in-new-tab
        e.preventDefault();
        go(page);
      }}
    >
      {label}
      {arrow && <Icon name="arrowRight" size={11} />}
    </a>
  );
}

/** Card header shared by the framed modules (icon · title · sub · action). */
function CardHead({ icon, iconColor, title, sub, action, pad }: {
  icon: string; iconColor: string; title: string; sub?: string; action?: ReactNode; pad?: boolean;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: pad ? '11px 13px' : undefined, marginBottom: pad ? 0 : 10, borderBottom: pad ? '1px solid var(--border-subtle)' : undefined }}>
      <div className="row gap-8">
        <Icon name={icon} size={14} style={{ color: iconColor }} />
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{title}</span>
        {sub && <span className="muted" style={{ fontSize: 11 }}>{sub}</span>}
      </div>
      {action}
    </div>
  );
}

// ---- Stat tiles ----

export function StatTile({ icon, label, value, delta, deltaInvert, spark, sparkColor, color, note, onClick }: {
  icon: string; label: string; value: string; delta?: number; deltaInvert?: boolean;
  spark?: number[]; sparkColor?: string; color?: string; note?: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card card-btn"
      style={{ textAlign: 'left', padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div className="row gap-8" style={{ color: 'var(--text-muted)' }}>
        <Icon name={icon} size={13} style={{ color: color || 'var(--text-muted)' }} />
        <span className="eyebrow" style={{ letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 }}>
        <div className="tabular" style={{ fontSize: 23, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
        {spark && spark.length > 1 && <Sparkline data={spark} color={sparkColor || color || 'var(--accent)'} fill w={64} h={22} />}
      </div>
      {note
        ? <div className="muted" style={{ fontSize: 10.5 }}>{note}</div>
        : delta !== undefined && <Delta value={delta} invert={deltaInvert} />}
    </button>
  );
}

// ---- Recent neighborhood ----

/**
 * Pick the mini-canvas slice from the files Claude touched most recently
 * (heatmap Read/Edit/Write paths — the design header reads "last edited
 * files"), suffix-matching the agent's absolute paths onto the graph's
 * repo-relative ones. With no ingest data (or too little overlap for a
 * meaningful neighborhood) fall back to the highest-degree slice.
 */
export function buildNeighborhood(graph: GraphFullResponse, heatFiles: HeatmapFile[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  if (!graph.nodes.length) return { nodes: [], edges: [] };
  const MAX = 12;
  const picked: GraphFullResponse['nodes'] = [];
  const seen = new Set<string>();
  for (const f of heatFiles) {
    for (const n of graph.nodes) {
      if (picked.length >= MAX) break;
      if (seen.has(n.id)) continue;
      if (f.path === n.filePath || f.path.endsWith('/' + n.filePath)) {
        picked.push(n);
        seen.add(n.id);
      }
    }
    if (picked.length >= MAX) break;
  }
  const chosen = picked.length >= 3 ? picked : graph.nodes.slice(0, MAX);
  const ids = new Set(chosen.map((n) => n.id));
  const edges = graph.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, kind: e.provenance === 'heuristic' ? 'synth' : e.kind }));
  return { nodes: spiralLayout(chosen), edges };
}

export function RecentNeighborhood({ graph, heatFiles }: { graph: GraphFullResponse; heatFiles: HeatmapFile[] }) {
  const { nodes, edges } = useMemo(() => buildNeighborhood(graph, heatFiles), [graph, heatFiles]);
  return (
    <div className="card" style={{ overflow: 'hidden', height: 340, display: 'flex', flexDirection: 'column' }}>
      <CardHead icon="graph" iconColor="var(--accent)" title="Recent neighborhood" sub="· last edited files" pad
        action={<CrossLink label="Open graph" page="graph" arrow />} />
      <div style={{ flex: 1, minHeight: 0 }}>
        {nodes.length
          ? <GraphCanvas nodes={nodes} edges={edges} onSelect={(id) => go('graph', { query: { focus: id } })} interactive />
          : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
              <div className="muted" style={{ fontSize: 12 }}>Nothing indexed yet — run specship index.</div>
            </div>
          )}
      </div>
    </div>
  );
}

// ---- Tips rail ----

function TipRow({ tip, onApply, onDismiss }: { tip: ClaudeTip; onApply: () => void; onDismiss: () => void }) {
  const col = tip.severity === 'error' ? 'var(--error)' : tip.severity === 'warn' ? 'var(--warn)' : 'var(--info)';
  const applied = tip.state === 'applied';
  return (
    <div
      onClick={() => go('tips', { query: { sel: tip.id } })}
      title="View in Tips"
      onAnimationEnd={(e) => { e.currentTarget.style.animation = 'none'; }}
      style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-panel-2)', border: '1px solid var(--border-subtle)', borderLeft: `2.5px solid ${col}`, animation: 'slideInRight 200ms ease', cursor: 'pointer', opacity: applied ? 0.65 : 1 }}
    >
      <div style={{ color: col, flexShrink: 0, marginTop: 1 }}><Icon name={tip.icon} size={14} /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 550, lineHeight: 1.35, textWrap: 'pretty' }}>{tip.title}</div>
        <div className="row gap-8" style={{ marginTop: 7 }}>
          <code className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)', background: 'var(--bg-canvas)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{tip.fix}</code>
          <span className="grow" />
          <span className="pill" style={{ fontSize: 10, color: col, background: 'transparent' }}>{tip.saving}</span>
        </div>
      </div>
      <div className="row gap-4" style={{ flexShrink: 0 }}>
        {applied
          ? (
            <span className="pill" style={{ color: 'var(--success)', background: 'var(--success-soft)' }}>
              <Icon name="check" size={11} />Applied
            </span>
          )
          : <button className="btn btn-secondary btn-xs" onClick={(e) => { e.stopPropagation(); onApply(); }} title="Mark applied">Apply</button>}
        <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); onDismiss(); }} title="Dismiss"><Icon name="x" size={12} /></button>
      </div>
    </div>
  );
}

export function TipsRail({ tips, onSetState, noIngest, onIngested }: {
  tips: ClaudeTip[];
  onSetState: (id: string, state: 'applied' | 'dismissed') => void;
  noIngest: boolean;
  onIngested: () => void;
}) {
  const urgent = tips.filter((t) => t.severity === 'error' && t.state !== 'applied').length;
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 340 }}>
      <div className="row" style={{ justifyContent: 'space-between', padding: '11px 13px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row gap-8">
          <Icon name="tips" size={14} style={{ color: 'var(--warn)' }} />
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>Tips</span>
          {urgent > 0 && <span className="pill" style={{ fontSize: 10, background: 'var(--error-soft)', color: 'var(--error)' }}>{urgent} urgent</span>}
        </div>
        <CrossLink label="All" page="tips" />
      </div>
      {noIngest && !tips.length
        ? <NeedsIngest onIngested={onIngested} />
        : (
          <div className="scroll-y" style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tips.slice(0, 4).map((t) => (
              <TipRow key={t.id} tip={t} onApply={() => onSetState(t.id, 'applied')} onDismiss={() => onSetState(t.id, 'dismissed')} />
            ))}
            {!tips.length && (
              <div className="muted" style={{ fontSize: 12, padding: 8 }}>No tips — nothing wasteful in your recent sessions.</div>
            )}
          </div>
        )}
    </div>
  );
}

// ---- Tool-call heatstrip ----

export function Heatstrip({ files, noIngest, onIngested }: { files: HeatmapFile[]; noIngest: boolean; onIngested: () => void }) {
  const stats = files.slice(0, 14).map((f) => {
    const tokens = f.resultBytes ?? 0;
    return { path: f.path, calls: f.calls, tokens, tpc: f.calls > 0 ? tokens / f.calls : 0 };
  });
  const maxTpc = Math.max(...stats.map((s) => s.tpc), 0) || 1;
  const items = stats.map((s) => ({
    key: s.path,
    label: shortPath(s.path),
    value: s.calls,
    intensity: s.tpc / maxTpc,
    sub: s.calls + ' calls',
    title: `${s.path}\n${s.calls} calls · ${fmtTok(s.tokens)} tokens · ${fmtTok(Math.round(s.tpc))}/call`,
  }));
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHead icon="flame" iconColor="var(--warn)" title="Tool-call heatmap" sub="· area = calls, color = tokens / call"
        action={<CrossLink label="Open heatmap" page="heatmap" arrow />} />
      {noIngest || !items.length
        ? (noIngest
          ? <NeedsIngest onIngested={onIngested} />
          : <div className="muted" style={{ fontSize: 12, padding: '18px 4px' }}>No file-touching tool calls in this range.</div>)
        : (
          <>
            <Treemap items={items} height={116} selKey={null} onPick={() => go('heatmap')} />
            <div className="row gap-10" style={{ marginTop: 9, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 10 }}>tokens / call</span>
              <div style={{ width: 96, height: 6, borderRadius: 999, background: 'linear-gradient(90deg, var(--node-route), var(--warn), var(--error))' }} />
              <span className="muted" style={{ fontSize: 9.5 }}>efficient → wasteful</span>
            </div>
          </>
        )}
    </div>
  );
}

// ---- Recent prompts ----

function PromptRow({ p, max }: { p: CostPrompt; max: number }) {
  const tokens = p.input_tokens + p.output_tokens + p.cache_creation_tokens + p.cache_read_tokens;
  const inputTotal = p.input_tokens + p.cache_creation_tokens + p.cache_read_tokens;
  const cacheRate = inputTotal > 0 ? p.cache_read_tokens / inputTotal : 0;
  const frac = p.cost_usd / max;
  return (
    <div
      onClick={() => go('sessions', { query: { sel: p.session_id } })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('sessions', { query: { sel: p.session_id } }); } }}
      className="row gap-10 list-row"
      style={{ padding: '7px 4px', borderRadius: 6, cursor: 'pointer' }}
    >
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {!!p.is_sidechain && <Icon name="bot" size={11} style={{ color: 'var(--node-code)', marginRight: 5, verticalAlign: '-1px' }} />}
          {cleanText(p.text)}
        </div>
        <div style={{ marginTop: 4, width: '70%' }}>
          <Bar frac={frac} color={frac > 0.7 ? 'var(--error)' : 'var(--accent)'} />
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="mono tabular" style={{ fontSize: 12, fontWeight: 600, color: frac > 0.7 ? 'var(--error)' : 'var(--text-primary)' }}>${p.cost_usd.toFixed(2)}</div>
        <div className="mono muted" style={{ fontSize: 10 }}>{fmtTok(tokens)} · {Math.round(cacheRate * 100)}%</div>
      </div>
    </div>
  );
}

export function RecentPrompts({ prompts, noIngest, onIngested }: { prompts: CostPrompt[]; noIngest: boolean; onIngested: () => void }) {
  const recent = [...prompts].sort((a, b) => b.ts - a.ts).slice(0, 8);
  const max = Math.max(...recent.map((p) => p.cost_usd), 0) || 1;
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHead icon="coins" iconColor="var(--accent)" title="Recent prompts" sub="· by cost"
        action={<CrossLink label="Cost ranking" page="costs" />} />
      {noIngest
        ? <NeedsIngest onIngested={onIngested} />
        : (
          <div className="col">
            {recent.map((p) => <PromptRow key={p.id} p={p} max={max} />)}
            {!recent.length && <div className="muted" style={{ fontSize: 12, padding: '10px 4px' }}>No prompt spend in this range.</div>}
          </div>
        )}
    </div>
  );
}

// ---- Cache analytics ----

function kv(label: string, value: string, sub?: string, color?: string) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="mono tabular" style={{ fontSize: 15, fontWeight: 600, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="mono muted" style={{ fontSize: 9.5 }}>{sub}</div>}
    </div>
  );
}

const SAVED_LABEL: Record<string, string> = {
  today: 'Saved today', week: 'Saved this week', month: 'Saved this month', all: 'Saved all time',
};

export function CacheCard({ cache, range, noIngest, onIngested }: {
  cache: ClaudeCacheResponse; range: string; noIngest: boolean; onIngested: () => void;
}) {
  const wowPct = Math.round(cache.wowDelta * 100);
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row gap-8">
        <Icon name="database" size={14} style={{ color: 'var(--node-route)' }} />
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>Cache analytics</span>
      </div>
      {noIngest
        ? <NeedsIngest onIngested={onIngested} />
        : (
          <>
            <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
              <div className="tabular" style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 0.9, color: 'var(--node-route)' }}>
                {Math.round(cache.readRate * 100)}%
              </div>
              <div style={{ paddingBottom: 3 }}>
                <div className="muted" style={{ fontSize: 11 }}>cache read rate</div>
                <Delta value={cache.wowDelta} />
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--border-subtle)' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              {kv('Creation tokens', fmtTok(cache.creationTokens), 'written to cache')}
              {kv('Read tokens', fmtTok(cache.readTokens), 'charged at ~10%')}
              {kv(SAVED_LABEL[range] ?? 'Saved this week', '$' + cache.dollarsSaved.toFixed(0), 'vs no cache — est.', 'var(--success)')}
              {kv('WoW', (wowPct >= 0 ? '+' : '') + wowPct + '%', wowPct >= 0 ? 'more reuse' : 'less reuse', wowPct >= 0 ? 'var(--success)' : 'var(--error)')}
            </div>
          </>
        )}
    </div>
  );
}

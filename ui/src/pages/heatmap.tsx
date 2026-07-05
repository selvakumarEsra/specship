/**
 * Heatmap — where tool calls land (REQ-DESKTOP-024): the files treemap with
 * a calls/tokens metric toggle, tools ranked by result tokens, subagent
 * attribution, and per-file / per-tool / per-subagent drill-down rails fed by
 * the /api/claude/heatmap/* endpoints. Layout per
 * specs/specship-desktop/screens-claude.jsx Heatmap.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { api, type ClaudeHeatmapResponse, type HeatmapFile } from '../api';
import { IngestGuidance } from '../components/claude-analytics';
import { HBars, Sparkline, Treemap } from '../components/charts';
import { fmtTok, Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { Bar, CopyBtn, PageHead, RangeSelector, Segmented } from '../components/ui';
import { useApi } from '../hooks';
import { go } from '../router';
import type { PageProps } from './types';

/** Last two path segments — heatmap paths are absolute, cells are small. */
const shortPath = (p: string): string => p.split('/').filter(Boolean).slice(-2).join('/');

type SelKind = 'file' | 'tool' | 'subagent';
interface Sel { type: SelKind; key: string }

// @implements REQ-DESKTOP-024
export function HeatmapPage(_props: PageProps) {
  const [range, setRange] = useState('week');
  const [metric, setMetric] = useState('calls');
  const [sel, setSel] = useState<Sel | null>(null);

  const stats = useApi(() => api.claudeStats(), []);
  const heatmap = useApi(() => api.claudeHeatmap(range), [range]);

  const noIngest = stats.data?.sessionCount === 0;
  const reload = () => { stats.reload(); heatmap.reload(); };

  const pick = (type: SelKind, key: string) =>
    setSel((s) => (s && s.type === type && s.key === key ? null : { type, key }));

  if (noIngest) {
    return (
      <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
        <PageHead icon="heatmap" title="Heatmap" sub="Where tool calls land — files, tools, subagents" />
        <IngestGuidance onIngested={reload} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div className="scroll-y" style={{ flex: 1, padding: 18, minWidth: 0 }}>
        <PageHead
          icon="heatmap"
          title="Heatmap"
          sub="Where tool calls land — files, tools, subagents"
          actions={<RangeSelector value={range} onChange={setRange} />}
        />
        <Module state={heatmap} label="heatmap" minHeight={320}>
          {(h) => <HeatmapBody h={h} range={range} metric={metric} onMetric={setMetric} sel={sel} pick={pick} />}
        </Module>
      </div>
      {sel?.type === 'file' && <div style={railStyle}><FileRail path={sel.key} range={range} files={heatmap.data?.files ?? []} onClose={() => setSel(null)} /></div>}
      {sel?.type === 'tool' && <div style={railStyle}><ToolRail name={sel.key} range={range} onClose={() => setSel(null)} /></div>}
      {sel?.type === 'subagent' && <div style={railStyle}><SubagentRail type={sel.key} range={range} onClose={() => setSel(null)} /></div>}
    </div>
  );
}

function HeatmapBody({ h, range, metric, onMetric, sel, pick }: {
  h: ClaudeHeatmapResponse; range: string; metric: string; onMetric: (m: string) => void;
  sel: Sel | null; pick: (type: SelKind, key: string) => void;
}) {
  const totalCalls = h.tools.reduce((a, t) => a + t.calls, 0);
  const totalTok = h.tools.reduce((a, t) => a + (t.resultBytes ?? 0), 0);
  if (!totalCalls) {
    return <div className="muted" style={{ fontSize: 12, padding: '14px 4px' }}>No tool calls in this range.</div>;
  }
  const busiest = [...h.files].sort((a, b) => b.calls - a.calls)[0];
  const heaviest = [...h.tools].sort((a, b) => (b.resultBytes ?? 0) - (a.resultBytes ?? 0))[0];
  const toolsByTok = [...h.tools].sort((a, b) => (b.resultBytes ?? 0) - (a.resultBytes ?? 0));
  const maxTok = Math.max(...h.tools.map((t) => t.resultBytes ?? 0), 0) || 1;

  const fileStats = h.files.map((f) => {
    const tokens = f.resultBytes ?? 0;
    return { ...f, tokens, tpc: f.calls > 0 ? tokens / f.calls : 0 };
  });
  const maxTpc = Math.max(...fileStats.map((f) => f.tpc), 0) || 1;
  const items = fileStats.map((f) => ({
    key: f.path,
    label: shortPath(f.path),
    value: metric === 'tokens' ? f.tokens : f.calls,
    intensity: f.tpc / maxTpc,
    sub: metric === 'tokens' ? fmtTok(f.tokens) : f.calls + ' calls',
    title: `${f.path}\n${f.calls} calls · ${fmtTok(f.tokens)} result tokens · ${fmtTok(Math.round(f.tpc))}/call`,
  }));

  return (
    <>
      {/* summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <HSum label="Tool calls" value={totalCalls.toLocaleString()} icon="wrench" color="var(--node-spec)" sub={'this ' + range} />
        <HSum label="Result tokens" value={fmtTok(totalTok)} icon="database" color="var(--node-route)" sub="returned to context" />
        <HSum label="Busiest file" value={busiest ? shortPath(busiest.path) : '—'} icon="box" color="var(--warn)" sub={busiest ? busiest.calls + ' calls' : ''} />
        <HSum label="Heaviest tool" value={heaviest?.name ?? '—'} icon="flame" color="var(--error)" sub={heaviest ? fmtTok(heaviest.resultBytes ?? 0) + ' tokens' : ''} />
      </div>

      {/* files treemap */}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row gap-8" style={{ marginBottom: 12 }}>
          <Icon name="box" size={14} style={{ color: 'var(--warn)' }} />
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>Files</span>
          <span className="muted" style={{ fontSize: 11 }}>· area = {metric === 'tokens' ? 'result tokens' : 'tool calls'}, color = tokens / call</span>
          <div className="grow" />
          <Segmented size="sm" label="Treemap metric" value={metric} onChange={onMetric} options={[{ value: 'calls', label: 'Calls' }, { value: 'tokens', label: 'Tokens' }]} />
        </div>
        {items.length
          ? <Treemap items={items} height={268} selKey={sel?.type === 'file' ? sel.key : null} onPick={(c) => pick('file', c.key)} />
          : <div className="muted" style={{ fontSize: 12, padding: '14px 4px' }}>No file-touching tool calls in this range.</div>}
        <div className="row gap-12" style={{ marginTop: 10, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 10.5 }}>tokens / call</span>
          <div style={{ width: 120, height: 7, borderRadius: 999, overflow: 'hidden', background: 'linear-gradient(90deg, var(--node-route), var(--warn), var(--error))' }} />
          <span className="muted" style={{ fontSize: 10 }}>efficient → wasteful</span>
          <div className="grow" />
          <span className="muted" style={{ fontSize: 10.5 }}>click a tile to drill in</span>
        </div>
      </div>

      {/* tools + subagents */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card card-pad">
          <div className="row gap-8" style={{ marginBottom: 4 }}>
            <Icon name="wrench" size={14} style={{ color: 'var(--node-code)' }} />
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>Tools</span>
            <span className="muted" style={{ fontSize: 11 }}>· by result tokens, ranked</span>
          </div>
          <div className="row" style={{ padding: '8px 0 4px', fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            <span style={{ width: 116 }}>Tool</span>
            <span className="grow">Result tokens</span>
            <span style={{ width: 36, textAlign: 'right' }}>Calls</span>
            <span style={{ width: 64, textAlign: 'right' }}>Per call</span>
            <span style={{ width: 48, textAlign: 'right' }}>Total</span>
            <span style={{ width: 14 }} />
          </div>
          <div className="col gap-2">
            {toolsByTok.map((t) => (
              <ToolEffRow key={t.name} name={t.name} calls={t.calls} tokens={t.resultBytes ?? 0} maxTok={maxTok}
                selected={sel?.type === 'tool' && sel.key === t.name} onClick={() => pick('tool', t.name)} />
            ))}
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 10, display: 'flex', gap: 12 }}>
            <Legend color="var(--error)" label=">20k / call" />
            <Legend color="var(--warn)" label=">8k" />
            <Legend color="var(--success)" label="lean" />
          </div>
        </div>
        <div className="card card-pad">
          <div className="row gap-8" style={{ marginBottom: 14 }}>
            <Icon name="bot" size={14} style={{ color: 'var(--node-route)' }} />
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>Subagents</span>
            <span className="muted" style={{ fontSize: 11 }}>· Task calls by subagent_type</span>
          </div>
          {h.subagentByName.length
            ? (
              <HBars
                items={h.subagentByName as unknown as Array<Record<string, unknown>>}
                valueKey="calls"
                labelKey="name"
                color="var(--node-route)"
                onItemClick={(it) => pick('subagent', String(it.name))}
                selectedKey={sel?.type === 'subagent' ? sel.key : null}
              />
            )
            : <div className="muted" style={{ fontSize: 12 }}>No subagent invocations in this range.</div>}
        </div>
      </div>
    </>
  );
}

function HSum({ label, value, icon, color, sub }: { label: string; value: string; icon: string; color: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div className="row gap-6" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        <Icon name={icon} size={12} style={{ color, flexShrink: 0 }} />
        <span className="eyebrow" style={{ letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </div>
      <div className="mono tabular" style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div className="mono muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  );
}

function ToolEffRow({ name, calls, tokens, maxTok, selected, onClick }: {
  name: string; calls: number; tokens: number; maxTok: number; selected: boolean; onClick: () => void;
}) {
  const tpc = tokens / Math.max(1, calls);
  const eff = tpc > 20000 ? 'var(--error)' : tpc > 8000 ? 'var(--warn)' : 'var(--success)';
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="row gap-8 list-row"
      style={{ padding: '6px 8px', margin: '0 -8px', borderRadius: 6, cursor: 'pointer', background: selected ? 'var(--accent-soft)' : undefined }}
    >
      <span className="mono" style={{ width: 116, flexShrink: 0, fontSize: 11.5, color: selected ? 'var(--accent)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <div className="grow" style={{ height: 16, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: (tokens / maxTok) * 100 + '%', height: '100%', background: eff, borderRadius: 4 }} />
      </div>
      <span className="mono tabular muted" style={{ width: 36, textAlign: 'right', fontSize: 10.5, flexShrink: 0 }}>×{calls}</span>
      <span className="mono tabular" style={{ width: 64, textAlign: 'right', fontSize: 10.5, color: eff, flexShrink: 0 }}>{fmtTok(Math.round(tpc))}/call</span>
      <span className="mono tabular" style={{ width: 48, textAlign: 'right', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{fmtTok(tokens)}</span>
      <Icon name="chevronRight" size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="row gap-4">
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}

// ---- Drill-down rails ----

const railStyle: CSSProperties = {
  width: 360, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)',
  background: 'var(--bg-panel)', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%',
};

function DrillHeader({ icon, color, title, copy, onClose }: { icon: string; color: string; title: string; copy?: string; onClose: () => void }) {
  return (
    <div className="row gap-8" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      <Icon name={icon} size={14} style={{ color, flexShrink: 0 }} />
      <span className="mono grow" style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      {copy && <CopyBtn text={copy} />}
      <button className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close drill-down"><Icon name="x" size={14} /></button>
    </div>
  );
}

/** A clickable session row shared by the three rails. */
function SessionLinkRow({ id, meta }: { id: string; meta: string }) {
  return (
    <div
      onClick={() => go('sessions', { query: { sel: id } })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('sessions', { query: { sel: id } }); } }}
      className="row gap-8 list-row"
      style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
    >
      <span className="mono" style={{ fontSize: 11.5, flexShrink: 0 }}>{id.slice(0, 8)}</span>
      <span className="muted grow" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      <Icon name="chevronRight" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </div>
  );
}

function RailBody<T>({ state, children }: { state: ApiStateLike<T>; children: (d: T) => ReactNode }) {
  return (
    <div className="scroll-y" style={{ flex: 1, padding: 14 }}>
      <Module state={state} label="drill-down" minHeight={120}>{children}</Module>
    </div>
  );
}
type ApiStateLike<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void };

function FileRail({ path, range, files, onClose }: { path: string; range: string; files: HeatmapFile[]; onClose: () => void }) {
  const detail = useApi(() => api.claudeHeatmapFile(path, range), [path, range]);
  const cell = files.find((f) => f.path === path);
  return (
    <div className="col" style={{ height: '100%' }}>
      <DrillHeader icon="box" color="var(--warn)" title={path} copy={path} onClose={onClose} />
      <RailBody state={detail}>
        {(d) => {
          const totalBytes = d.byTool.reduce((a, t) => a + t.bytes, 0) || 1;
          const heavy = d.byTool.find((t) => t.bytes > 40000);
          return (
            <>
              <div className="row" style={{ gap: 20, marginBottom: 16 }}>
                <div>
                  <div className="muted" style={{ fontSize: 10.5 }}>Tool calls</div>
                  <div className="tabular" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{cell?.calls ?? d.byTool.reduce((a, t) => a + t.calls, 0)}</div>
                </div>
                {cell && cell.trend.some((v) => v > 0) && (
                  <div className="grow">
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>7-day trend</div>
                    <Sparkline data={cell.trend} color="var(--warn)" fill w={150} h={30} />
                  </div>
                )}
              </div>

              {heavy && (
                <div style={{ background: 'var(--warn-soft)', border: '1px solid rgba(229,165,10,0.25)', borderRadius: 8, padding: '9px 11px', marginBottom: 16, display: 'flex', gap: 9 }}>
                  <Icon name="flame" size={14} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                    <span className="mono" style={{ color: 'var(--warn)' }}>{heavy.name}</span> returned <span className="mono">{fmtTok(heavy.bytes)}</span> tokens here. A structural query would cover it in a fraction.
                  </div>
                </div>
              )}

              <div className="eyebrow" style={{ marginBottom: 8 }}>Tool breakdown</div>
              <div className="col gap-8" style={{ marginBottom: 18 }}>
                {d.byTool.map((tc) => (
                  <div key={tc.name} className="row gap-10">
                    <span className="mono" style={{ fontSize: 11.5, width: 92, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tc.name}</span>
                    <div className="grow"><Bar frac={tc.bytes / totalBytes} color={tc.bytes > 40000 ? 'var(--error)' : tc.bytes > 12000 ? 'var(--warn)' : 'var(--node-code)'} /></div>
                    <span className="mono tabular muted" style={{ fontSize: 10.5, width: 22, textAlign: 'right' }}>×{tc.calls}</span>
                    <span className="mono tabular" style={{ fontSize: 10.5, width: 44, textAlign: 'right' }}>{fmtTok(tc.bytes)}</span>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: 10 }}>bar = result tokens · × = call count</div>
              </div>

              <div className="eyebrow" style={{ marginBottom: 8 }}>Touched in {d.sessions.length} session{d.sessions.length === 1 ? '' : 's'}</div>
              <div className="col gap-6">
                {d.sessions.map((s) => (
                  <SessionLinkRow key={s.session_id} id={s.session_id} meta={`${s.calls} calls · ${fmtTok(s.bytes)} tokens${s.last_model ? ' · ' + s.last_model : ''}`} />
                ))}
              </div>
            </>
          );
        }}
      </RailBody>
    </div>
  );
}

function ToolRail({ name, range, onClose }: { name: string; range: string; onClose: () => void }) {
  const detail = useApi(() => api.claudeHeatmapTool(name, range), [name, range]);
  return (
    <div className="col" style={{ height: '100%' }}>
      <DrillHeader icon="wrench" color="var(--node-code)" title={name} copy={name} onClose={onClose} />
      <RailBody state={detail}>
        {(d) => {
          const avg = d.totals.calls > 0 ? Math.round(d.totals.bytes / d.totals.calls) : 0;
          const maxBytes = Math.max(...d.inputs.map((i) => i.bytes), 0) || 1;
          return (
            <>
              <div className="row" style={{ gap: 16, marginBottom: 16 }}>
                <div>
                  <div className="muted" style={{ fontSize: 10.5 }}>Calls</div>
                  <div className="tabular" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{d.totals.calls}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10.5 }}>Result tokens</div>
                  <div className="tabular" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: d.totals.bytes > 1e6 ? 'var(--error)' : 'var(--text-primary)' }}>{fmtTok(d.totals.bytes)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10.5 }}>Sessions</div>
                  <div className="tabular" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{d.totals.sessions}</div>
                </div>
              </div>
              <div className="row gap-8" style={{ marginBottom: 16 }}>
                <span className="muted" style={{ fontSize: 11 }}>avg per call</span>
                <span className="mono tabular" style={{ fontSize: 12, color: avg > 30000 ? 'var(--error)' : avg > 8000 ? 'var(--warn)' : 'var(--text-secondary)' }}>{fmtTok(avg)} tokens</span>
              </div>

              <div className="eyebrow" style={{ marginBottom: 8 }}>Top inputs</div>
              <div className="col gap-7" style={{ marginBottom: 18 }}>
                {d.inputs.slice(0, 8).map((inp) => (
                  <div key={inp.input} className="row gap-8">
                    <span className="mono" style={{ fontSize: 11, width: 150, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={inp.input}>{inp.input}</span>
                    <div className="grow"><Bar frac={inp.bytes / maxBytes} color={inp.bytes > 40000 ? 'var(--error)' : 'var(--node-code)'} /></div>
                    <span className="mono tabular muted" style={{ fontSize: 10, width: 20, textAlign: 'right' }}>×{inp.calls}</span>
                    <span className="mono tabular" style={{ fontSize: 10, width: 40, textAlign: 'right' }}>{fmtTok(inp.bytes)}</span>
                  </div>
                ))}
                {!d.inputs.length && <div className="muted" style={{ fontSize: 11.5 }}>No recorded inputs.</div>}
              </div>

              <div className="eyebrow" style={{ marginBottom: 8 }}>Used in {d.totals.sessions} session{d.totals.sessions === 1 ? '' : 's'}</div>
              <div className="col gap-6">
                {d.recentSessions.map((s) => (
                  <SessionLinkRow key={s.session_id} id={s.session_id} meta={`${s.calls} calls${s.last_model ? ' · ' + s.last_model : ''}`} />
                ))}
              </div>
            </>
          );
        }}
      </RailBody>
    </div>
  );
}

function SubagentRail({ type, range, onClose }: { type: string; range: string; onClose: () => void }) {
  const detail = useApi(() => api.claudeHeatmapSubagent(type, range), [type, range]);
  return (
    <div className="col" style={{ height: '100%' }}>
      <DrillHeader icon="bot" color="var(--node-route)" title={type} copy={type} onClose={onClose} />
      <RailBody state={detail}>
        {(d) => (
          <>
            <div className="row" style={{ gap: 16, marginBottom: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>Invocations</div>
                <div className="tabular" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{d.totals.calls}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 10.5 }}>Sessions</div>
                <div className="tabular" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{d.totals.sessions}</div>
              </div>
            </div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Recent invocations</div>
            <div className="col gap-6" style={{ marginBottom: 16 }}>
              {d.invocations.slice(0, 12).map((inv, i) => (
                <div key={inv.session_id + ':' + inv.ts + ':' + i} style={{ border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.description || inv.prompt.slice(0, 90) || '(no description)'}</div>
                  <div className="row gap-8" style={{ marginTop: 5 }}>
                    <button className="btn btn-ghost btn-xs mono" onClick={() => go('sessions', { query: { sel: inv.session_id } })}>{inv.session_id.slice(0, 8)}</button>
                    {inv.last_model && <span className="mono muted" style={{ fontSize: 10 }}>{inv.last_model}</span>}
                  </div>
                </div>
              ))}
              {!d.invocations.length && <div className="muted" style={{ fontSize: 11.5 }}>No invocations in this range.</div>}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => go('tips')}>
              <Icon name="tips" size={13} />See related tips
            </button>
          </>
        )}
      </RailBody>
    </div>
  );
}

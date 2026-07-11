/**
 * Costs — where the money goes (REQ-DESKTOP-024): the daily spend line,
 * by-model donut, cache-effectiveness card and the most-expensive-prompts
 * ranking, arranged per specs/specship-desktop/screens-claude.jsx Costs.
 * The model filter narrows every card server-side (A2).
 */
import { useEffect, useState } from 'react';
import { api, type ClaudeCostsResponse, type CostPrompt } from '../api';
import { cacheColor, IngestGuidance, modelColor, modelShort } from '../components/claude-analytics';
import { Donut, LineChart, type LinePoint } from '../components/charts';
import { CacheCard, cleanText, fmtTok, Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { Bar, Delta, PageHead, RangeSelector } from '../components/ui';
import { useApi } from '../hooks';
import { go } from '../router';
import type { PageProps } from './types';

const RANGE_LABEL: Record<string, string> = { today: 'today', week: '7 days', month: '30 days', all: 'all time' };

// @implements REQ-DESKTOP-024
export function CostsPage(_props: PageProps) {
  const [range, setRange] = useState('month');
  const [model, setModel] = useState('');
  const [hover, setHover] = useState<LinePoint | null>(null);

  const stats = useApi(() => api.claudeStats(), []);
  const costs = useApi(() => api.claudeCosts(range, null, model || null), [range, model]);
  const cache = useApi(() => api.claudeCache(range), [range]);

  // Model options come from the un-narrowed response and are held while a
  // model is selected, so the active filter can always be changed or cleared.
  const [modelOpts, setModelOpts] = useState<string[]>([]);
  useEffect(() => {
    if (model || !costs.data) return;
    setModelOpts(costs.data.byModel.map((m) => m.model).filter((m): m is string => !!m));
  }, [model, costs.data]);

  const noIngest = stats.data?.sessionCount === 0;
  const reload = () => { stats.reload(); costs.reload(); cache.reload(); };

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <PageHead
        icon="dollar"
        title="Costs"
        sub="Where the money goes"
        actions={
          <>
            {!noIngest && (
              <select className="input" aria-label="Model filter" value={model} onChange={(e) => setModel(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
                <option value="">All models</option>
                {modelOpts.map((m) => <option key={m} value={m}>{modelShort(m)}</option>)}
              </select>
            )}
            <RangeSelector value={range} onChange={setRange} />
          </>
        }
      />
      {noIngest ? <IngestGuidance onIngested={reload} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14, marginBottom: 14 }}>
            <Module state={costs} label="cost series" minHeight={280}>
              {(c) => (
                <div className="card card-pad">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div className="tabular" style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.02em' }}>${c.total.toFixed(2)}</div>
                      <div className="row gap-8" style={{ marginTop: 2 }}>
                        <span className="muted" style={{ fontSize: 11.5 }}>total · {RANGE_LABEL[range] ?? range}</span>
                        <Delta value={c.wowDelta} invert />
                      </div>
                      {(c.unpricedSessions ?? 0) > 0 && (
                        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--warn)' }}
                          title="Sessions whose model has no pricing row — their cost is unknown and excluded from this total, not $0">
                          ⚠ excludes {c.unpricedSessions} unpriced session{c.unpricedSessions === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                    {hover && (
                      <div style={{ textAlign: 'right' }}>
                        <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>${hover.cost.toFixed(2)}</div>
                        <div className="muted" style={{ fontSize: 10.5 }}>{String(hover.prompts ?? 0)} prompts · {hover.day}d ago</div>
                      </div>
                    )}
                  </div>
                  <LineChart series={c.series} color="var(--accent)" onHover={setHover} h={200} />
                </div>
              )}
            </Module>
            <Module state={costs} label="cost by model" minHeight={280}>
              {(c) => <ByModelCard c={c} />}
            </Module>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
            <Module state={costs} label="expensive prompts" minHeight={280}>
              {(c) => <ExpensivePrompts prompts={c.topPrompts} />}
            </Module>
            <Module state={cache} label="cache analytics" minHeight={280}>
              {(c) => <CacheCard cache={c} range={range} noIngest={false} onIngested={reload} />}
            </Module>
          </div>
        </>
      )}
    </div>
  );
}

function ByModelCard({ c }: { c: ClaudeCostsResponse }) {
  const total = c.byModel.reduce((a, m) => a + (m.cost ?? 0), 0);
  const slices = c.byModel.map((m, i) => ({ label: modelShort(m.model ?? 'unknown'), cost: m.cost ?? 0, color: modelColor(i) }));
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="row gap-8" style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
        <Icon name="layers" size={14} style={{ color: 'var(--node-code)' }} />
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>By model</span>
      </div>
      {slices.length
        ? (
          <>
            <Donut data={slices} size={150} centerLabel={'$' + total.toFixed(0)} centerSub="in range" />
            <div className="col gap-6" style={{ marginTop: 14, width: '100%' }}>
              {slices.map((m, i) => (
                <div key={m.label} className="row gap-8">
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: modelColor(i), flexShrink: 0 }} />
                  <span className="mono grow" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  <span className="mono tabular" style={{ fontSize: 11.5 }}>${m.cost.toFixed(1)}</span>
                  <span className="mono tabular muted" style={{ fontSize: 10.5, width: 38, textAlign: 'right' }}>{total > 0 ? Math.round((m.cost / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </>
        )
        : <div className="muted" style={{ fontSize: 12, padding: '18px 0' }}>No model-attributed spend in this range.</div>}
    </div>
  );
}

function ExpensivePrompts({ prompts }: { prompts: CostPrompt[] }) {
  const ranked = prompts.slice(0, 8);
  const maxP = Math.max(...ranked.map((p) => p.cost_usd), 0) || 1;
  return (
    <div className="card card-pad">
      <div className="row gap-8" style={{ marginBottom: 12 }}>
        <Icon name="sortAsc" size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>Most expensive prompts</span>
        <span className="muted" style={{ fontSize: 11 }}>· top {ranked.length}</span>
      </div>
      {ranked.map((p, i) => {
        const tokens = p.input_tokens + p.output_tokens + p.cache_creation_tokens + p.cache_read_tokens;
        const inputTotal = p.input_tokens + p.cache_creation_tokens + p.cache_read_tokens;
        const cacheRate = inputTotal > 0 ? p.cache_read_tokens / inputTotal : 0;
        const frac = p.cost_usd / maxP;
        return (
          <div
            key={p.id}
            className="row gap-12 list-row"
            role="button"
            tabIndex={0}
            onClick={() => go('sessions', { query: { sel: p.session_id } })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('sessions', { query: { sel: p.session_id } }); } }}
            style={{ padding: '9px 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none', cursor: 'pointer' }}
          >
            <span className="mono muted tabular" style={{ width: 16, fontSize: 11 }}>{i + 1}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {!!p.is_sidechain && <Icon name="bot" size={11} style={{ color: 'var(--node-code)', marginRight: 5, verticalAlign: '-1px' }} />}
                {cleanText(p.text)}
              </div>
              <div style={{ marginTop: 4, maxWidth: 280 }}>
                <Bar frac={frac} color={frac > 0.66 ? 'var(--error)' : 'var(--accent)'} />
              </div>
            </div>
            <span className="mono muted" style={{ fontSize: 10.5, width: 84, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.model ? modelShort(p.model) : '—'}</span>
            <span className="mono tabular muted" style={{ fontSize: 11, width: 56, textAlign: 'right' }}>{fmtTok(tokens)}</span>
            <span className="mono tabular" style={{ fontSize: 11, width: 40, textAlign: 'right', color: cacheColor(cacheRate) }}>{Math.round(cacheRate * 100)}%</span>
            <span className="mono tabular" style={{ fontSize: 13, fontWeight: 600, width: 52, textAlign: 'right' }}>${p.cost_usd.toFixed(2)}</span>
          </div>
        );
      })}
      {!ranked.length && <div className="muted" style={{ fontSize: 12, padding: '10px 0' }}>No prompt spend in this range.</div>}
    </div>
  );
}

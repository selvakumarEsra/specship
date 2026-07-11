/**
 * Sessions — ingested Claude Code sessions with per-session detail
 * (REQ-DESKTOP-024): the sessions table with project + model filters, and
 * the session drill-in with its prompt timeline, quality signals and the
 * summary rail, arranged per specs/specship-desktop/screens-claude.jsx.
 */
import { useEffect, useState } from 'react';
import {
  api,
  type ClaudePrompt,
  type ClaudeSession,
  type ClaudeSessionSummaryResponse,
  type ClaudeToolCall,
} from '../api';
import {
  cacheColor,
  fmtDuration,
  fmtTime,
  fmtWhen,
  IngestGuidance,
  sessionCacheRate,
  StatBlock,
} from '../components/claude-analytics';
import { HBars } from '../components/charts';
import { cleanText, fmtTok, Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { Bar, PageHead, Pill, RangeSelector, Segmented } from '../components/ui';
import { useApi, type ApiState } from '../hooks';
import type { PageProps } from './types';

/** Last path segment — claude project_path values are absolute cwds. */
const projName = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;

// ---- Prompt quality (design's rule-based promptQuality on real rows) ----

function gradeOf(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Excellent', color: 'var(--success)' };
  if (score >= 70) return { label: 'Good', color: 'var(--node-route)' };
  if (score >= 50) return { label: 'Fair', color: 'var(--warn)' };
  return { label: 'Needs work', color: 'var(--error)' };
}

interface Quality { score: number; label: string; color: string }

export function promptQuality(p: ClaudePrompt, tools: ClaudeToolCall[]): Quality {
  const t = cleanText(p.text ?? '');
  const namesTarget = /REQ-[A-Z]+-\d+|[a-z][a-zA-Z]+[A-Z][a-zA-Z]+|[\w/]+\.(ts|tsx|js|jsx|md|py|rs|go)/.test(t);
  const vagueOpener = /^(read |grep |look |check |explain |tell me|why |what )/i.test(t.trim());
  const specific = (t.length >= 45 && !vagueOpener) || t.length >= 72;
  const inputTotal = p.input_tokens + p.cache_creation_tokens + p.cache_read_tokens;
  const cacheOk = inputTotal > 0 && p.cache_read_tokens / inputTotal >= 0.5;
  const heavyTool = tools.some((tc) => ['Bash', 'Grep', 'Read'].includes(tc.tool_name) && (tc.result_length ?? 0) > 30000);
  const structural = tools.some((tc) => tc.tool_name.includes('specship_'));
  let score = 62;
  score += namesTarget ? 12 : -10;
  score += specific ? 10 : -9;
  score += cacheOk ? 8 : -10;
  score += structural || !heavyTool ? 9 : -13;
  score = Math.max(14, Math.min(98, Math.round(score)));
  return { score, ...gradeOf(score) };
}

// ---- Token mix segments (design's TOK_SEG) ----

const TOK_SEG = [
  { key: 'input', label: 'Input', color: 'var(--node-spec)' },
  { key: 'output', label: 'Output', color: 'var(--node-code)' },
  { key: 'cacheCreate', label: 'Cache write', color: 'var(--warn)' },
  { key: 'cacheRead', label: 'Cache read', color: 'var(--node-route)' },
] as const;

type TokSplit = Record<(typeof TOK_SEG)[number]['key'], number>;

const promptSplit = (p: ClaudePrompt): TokSplit => ({
  input: p.input_tokens, output: p.output_tokens, cacheCreate: p.cache_creation_tokens, cacheRead: p.cache_read_tokens,
});

// @implements REQ-DESKTOP-024
export function SessionsPage({ query }: PageProps) {
  const [sel, setSel] = useState<string | null>(query.sel || null);
  if (sel) return <SessionDetail id={sel} onBack={() => setSel(null)} />;
  return <SessionsList onOpen={setSel} />;
}

function SessionsList({ onOpen }: { onOpen: (id: string) => void }) {
  const [range, setRange] = useState('week');
  const [proj, setProj] = useState('');
  const [model, setModel] = useState('');
  const [sort, setSort] = useState('cost');

  const stats = useApi(() => api.claudeStats(), []);
  const projects = useApi(() => api.claudeProjects(), []);
  const sessions = useApi(
    () => api.claudeSessions(proj || null, 200, range, model || null),
    [proj, model, range],
  );

  // The model options come from the un-narrowed list and are held while a
  // model is selected — otherwise the active filter would erase its own
  // alternatives from the dropdown.
  const [modelOpts, setModelOpts] = useState<string[]>([]);
  useEffect(() => {
    if (model || !sessions.data) return;
    const seen = new Set<string>();
    for (const s of sessions.data.sessions) if (s.last_model) seen.add(s.last_model);
    setModelOpts([...seen].sort());
  }, [model, sessions.data]);

  const noIngest = stats.data?.sessionCount === 0;
  const reload = () => { stats.reload(); sessions.reload(); projects.reload(); };

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ padding: '16px 18px 12px' }}>
        <PageHead
          icon="sessions"
          title="Sessions"
          sub={sessions.data ? `${sessions.data.sessions.length} sessions · ${proj ? projName(proj) : 'across all projects'}` : 'Loading sessions…'}
          actions={<RangeSelector value={range} onChange={setRange} />}
        />
      </div>
      {noIngest ? <IngestGuidance onIngested={reload} /> : (
        <>
          <div className="row gap-8" style={{ padding: '0 18px 12px' }}>
            <Icon name="filter" size={13} style={{ color: 'var(--text-muted)' }} />
            <select className="input" aria-label="Project filter" value={proj} onChange={(e) => setProj(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
              <option value="">All projects</option>
              {(projects.data?.projects ?? []).map((p) => <option key={p.path} value={p.path}>{p.name || projName(p.path)}</option>)}
            </select>
            <select className="input" aria-label="Model filter" value={model} onChange={(e) => setModel(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
              <option value="">All models</option>
              {modelOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="grow" />
            <span className="muted" style={{ fontSize: 11.5 }}>sort</span>
            <Segmented size="sm" label="Sort sessions" value={sort} onChange={setSort} options={[{ value: 'cost', label: 'Cost' }, { value: 'prompts', label: 'Prompts' }]} />
          </div>
          <div className="scroll-y" style={{ flex: 1, padding: '0 18px 18px' }}>
            <Module state={sessions} label="sessions" minHeight={220}>
              {(d) => <SessionsTable sessions={d.sessions} sort={sort} onOpen={onOpen} />}
            </Module>
          </div>
        </>
      )}
    </div>
  );
}

function SessionsTable({ sessions, sort, onOpen }: { sessions: ClaudeSession[]; sort: string; onOpen: (id: string) => void }) {
  const sorted = [...sessions].sort((a, b) => sort === 'prompts'
    ? (b.prompt_count ?? 0) - (a.prompt_count ?? 0)
    : (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0));
  if (!sorted.length) {
    return <div className="muted" style={{ fontSize: 12, padding: '14px 4px' }}>No sessions in this range for these filters.</div>;
  }
  const th: React.CSSProperties = { fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 };
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', ...th }}>
        <span style={{ width: 90 }}>Session</span>
        <span style={{ width: 110 }}>Project</span>
        <span className="grow">Window</span>
        <span style={{ width: 70, textAlign: 'right' }}>Prompts</span>
        <span style={{ width: 70, textAlign: 'right' }}>Cache</span>
        <span style={{ width: 70, textAlign: 'right' }}>Cost</span>
      </div>
      {sorted.map((s) => {
        const cache = sessionCacheRate(s);
        return (
          <div
            key={s.id}
            className="row list-row"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(s.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(s.id); } }}
            style={{ padding: '11px 14px', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}
          >
            <span className="mono" style={{ width: 90, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{s.id.slice(0, 8)}</span>
            <span style={{ width: 110, overflow: 'hidden' }}><Pill>{projName(s.project_path)}</Pill></span>
            <span className="mono muted grow" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fmtWhen(s.started_at)} – {fmtTime(s.ended_at)}  ·  {s.last_model ? s.last_model : '—'}
            </span>
            <span className="mono tabular" style={{ width: 70, textAlign: 'right', fontSize: 12 }}>{s.prompt_count ?? 0}</span>
            <span className="mono tabular" style={{ width: 70, textAlign: 'right', fontSize: 12, color: cacheColor(cache) }}>{Math.round(cache * 100)}%</span>
            {(s.unpriced_tokens ?? 0) > 0
              ? <span className="mono tabular" style={{ width: 70, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: 'var(--warn)' }}
                  title={`${s.unpriced_tokens} tokens on a model with no pricing row — cost unknown, not $0 (add pricing to heal)`}>unpriced ⚠</span>
              : <span className="mono tabular" style={{ width: 70, textAlign: 'right', fontSize: 12.5, fontWeight: 600 }}>${(s.total_cost_usd ?? 0).toFixed(2)}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---- Session detail ----

function SessionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = useApi(() => api.claudeSession(id), [id]);
  const summary = useApi(() => api.claudeSessionSummary(id), [id]);

  return (
    <Module state={detail} label="session detail" minHeight={320}>
      {(d) => {
        const s = d.session;
        const toolsByPrompt = new Map<string, ClaudeToolCall[]>();
        for (const t of d.toolCalls) {
          if (!t.prompt_id) continue;
          const arr = toolsByPrompt.get(t.prompt_id) ?? [];
          arr.push(t);
          toolsByPrompt.set(t.prompt_id, arr);
        }
        const cache = sessionCacheRate(s);
        const sideCost = d.prompts.filter((p) => p.is_sidechain).reduce((a, p) => a + (p.cost_usd ?? 0), 0);
        const maxPromptCost = Math.max(...d.prompts.map((p) => p.cost_usd ?? 0), 0) || 1;

        const totSplit: TokSplit = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
        for (const p of d.prompts) {
          const sp = promptSplit(p);
          for (const seg of TOK_SEG) totSplit[seg.key] += sp[seg.key];
        }
        const totTokens = TOK_SEG.reduce((a, seg) => a + totSplit[seg.key], 0) || 1;

        const qScores = d.prompts.map((p) => promptQuality(p, toolsByPrompt.get(p.id) ?? []).score);
        const avgQuality = qScores.length ? Math.round(qScores.reduce((a, b) => a + b, 0) / qScores.length) : 0;
        const qGrade = gradeOf(avgQuality);
        const weakCount = qScores.filter((x) => x < 60).length;

        return (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* main column */}
            <div className="scroll-y" style={{ flex: 1, padding: 18, minWidth: 0 }}>
              <div className="row gap-10" style={{ marginBottom: 14 }}>
                <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="chevronLeft" size={14} />Sessions</button>
                <span className="mono" style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.id.slice(0, 12)}</span>
                <Pill color="var(--node-spec)" bg="var(--node-spec-soft)">{projName(s.project_path)}</Pill>
                {s.last_model && <Pill>{s.last_model}</Pill>}
              </div>
              <div className="row" style={{ gap: 24, padding: '12px 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', marginBottom: 16, flexWrap: 'wrap' }}>
                {(s.total_cost_usd ?? 0) === 0 &&
                 ((s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0) + (s.total_cache_creation_tokens ?? 0) + (s.total_cache_read_tokens ?? 0)) > 0
                  ? <StatBlock label="Cost" value="unpriced ⚠" color="var(--warn)" />
                  : <StatBlock label="Cost" value={'$' + (s.total_cost_usd ?? 0).toFixed(2)} />}
                <StatBlock label="Prompts" value={s.prompt_count ?? d.prompts.length} />
                <StatBlock label="Cache hit" value={Math.round(cache * 100) + '%'} color={cacheColor(cache)} />
                <StatBlock label="Subagent $" value={'$' + sideCost.toFixed(2)} color="var(--node-code)" />
                <StatBlock label="Window" value={fmtWhen(s.started_at) + ' – ' + fmtTime(s.ended_at)} />
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="eyebrow">Prompt timeline · {d.prompts.length}</div>
                <span className="muted" style={{ fontSize: 11 }}>dot = prompt quality</span>
              </div>
              <div className="col gap-6">
                {d.prompts.map((p) => <PromptTimelineRow key={p.id} p={p} tools={toolsByPrompt.get(p.id) ?? []} />)}
                {!d.prompts.length && <div className="muted" style={{ fontSize: 12, padding: 8 }}>No prompts recorded for this session.</div>}
              </div>
              <div style={{ height: 20 }} />
            </div>

            {/* summary rail */}
            <div className="scroll-y" style={{ width: 290, flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-panel)', padding: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Token mix</div>
              <div className="row" style={{ height: 10, borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
                {TOK_SEG.map((seg) => (
                  <div key={seg.key} style={{ width: (totSplit[seg.key] / totTokens) * 100 + '%', height: '100%', background: seg.color }} />
                ))}
              </div>
              <div className="col gap-6" style={{ marginBottom: 20 }}>
                {TOK_SEG.map((seg) => (
                  <div key={seg.key} className="row gap-8">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                    <span className="muted grow" style={{ fontSize: 11.5 }}>{seg.label}</span>
                    <span className="mono tabular" style={{ fontSize: 11.5 }}>{fmtTok(totSplit[seg.key])}</span>
                    <span className="mono tabular muted" style={{ fontSize: 10, width: 32, textAlign: 'right' }}>{Math.round((totSplit[seg.key] / totTokens) * 100)}%</span>
                  </div>
                ))}
              </div>

              {/* Cache effectiveness */}
              <div style={{ background: 'var(--success-soft)', border: '1px solid rgba(70,194,107,0.25)', borderRadius: 8, padding: '10px 12px', marginBottom: 20 }}>
                <div className="row gap-8">
                  <Icon name="database" size={13} style={{ color: 'var(--success)' }} />
                  <span className="muted" style={{ fontSize: 10.5 }}>Cache effectiveness</span>
                </div>
                <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                  <span className="tabular" style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{Math.round(cache * 100)}%</span>
                  <span className="muted" style={{ fontSize: 10.5 }}>of input served from cache</span>
                </div>
              </div>

              {/* Avg prompt quality */}
              {qScores.length > 0 && (
                <div style={{ background: `color-mix(in srgb, ${qGrade.color} 7%, var(--bg-canvas))`, border: `1px solid color-mix(in srgb, ${qGrade.color} 30%, transparent)`, borderRadius: 8, padding: '10px 12px', marginBottom: 20 }}>
                  <div className="row gap-8" style={{ marginBottom: 8 }}>
                    <Icon name="sparkles" size={13} style={{ color: qGrade.color }} />
                    <span className="muted" style={{ fontSize: 10.5 }}>Avg prompt quality</span>
                  </div>
                  <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                    <span className="tabular" style={{ fontSize: 24, fontWeight: 700, color: qGrade.color }}>{avgQuality}</span>
                    <span className="muted" style={{ fontSize: 10.5 }}>/100 · {qGrade.label}</span>
                  </div>
                  <div style={{ margin: '8px 0 2px' }}><Bar frac={avgQuality / 100} color={qGrade.color} height={5} /></div>
                  {weakCount > 0 && (
                    <div className="muted" style={{ fontSize: 10.5, marginTop: 7 }}>
                      <span style={{ color: 'var(--warn)' }}>{weakCount} prompt{weakCount > 1 ? 's' : ''}</span> could be improved — name a symbol, file or REQ id
                    </div>
                  )}
                </div>
              )}

              <SummaryRail summaryState={summary} />
            </div>
          </div>
        );
      }}
    </Module>
  );
}

function PromptTimelineRow({ p, tools }: { p: ClaudePrompt; tools: ClaudeToolCall[] }) {
  const q = promptQuality(p, tools);
  const tokens = p.input_tokens + p.output_tokens + p.cache_creation_tokens + p.cache_read_tokens;
  const inputTotal = p.input_tokens + p.cache_creation_tokens + p.cache_read_tokens;
  const cache = inputTotal > 0 ? p.cache_read_tokens / inputTotal : 0;
  const hot = (p.cost_usd ?? 0) > 2.5;
  return (
    <div className="row gap-10 list-row" style={{ padding: '11px 12px', borderRadius: 8, background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}>
      <span className="mono muted" style={{ fontSize: 10.5, width: 52, flexShrink: 0 }}>{fmtTime(p.ts)}</span>
      <span
        title={`Prompt quality: ${q.label} (${q.score}/100)`}
        style={{ width: 8, height: 8, borderRadius: '50%', background: q.color, flexShrink: 0, boxShadow: `0 0 6px ${q.color}66` }}
      />
      <span className="grow" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {!!p.is_sidechain && <Pill color="var(--node-code)" bg="var(--node-code-soft)"><Icon name="bot" size={10} />subagent</Pill>}
        {!!p.is_sidechain && ' '}
        {cleanText(p.text ?? '') || <span className="muted">(no text)</span>}
      </span>
      <span className="row gap-4" style={{ flexShrink: 0 }}>
        <Icon name="wrench" size={11} style={{ color: 'var(--text-muted)' }} />
        <span className="mono tabular muted" style={{ fontSize: 11 }}>{tools.length}</span>
      </span>
      <span className="mono tabular muted" style={{ fontSize: 11, width: 50, textAlign: 'right', flexShrink: 0 }}>{fmtTok(tokens)}</span>
      <span className="mono tabular" style={{ fontSize: 11, width: 38, textAlign: 'right', flexShrink: 0, color: cacheColor(cache) }}>{Math.round(cache * 100)}%</span>
      <span className="mono tabular" style={{ fontSize: 13, fontWeight: 600, width: 54, textAlign: 'right', flexShrink: 0, color: hot ? 'var(--error)' : 'var(--text-primary)' }}>
        ${(p.cost_usd ?? 0).toFixed(2)}
      </span>
    </div>
  );
}

/** The /summary-fed rail sections: commands & skills, tools, files touched. */
function SummaryRail({ summaryState }: { summaryState: ApiState<ClaudeSessionSummaryResponse> }) {
  return (
    <Module state={summaryState} label="session summary" minHeight={120}>
      {(sum) => {
        const toolItems = sum.byTool.map((t) => ({ name: t.name, calls: t.calls, totalBytes: t.totalBytes }));
        return (
          <>
            {(sum.slashCommands.length > 0 || sum.skills.length > 0) && (
              <div style={{ marginBottom: 20 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Commands & skills</div>
                <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
                  {sum.slashCommands.map((c) => (
                    <span key={c.name} className="pill" style={{ color: 'var(--node-code)', background: 'var(--node-code-soft)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      <Icon name="command" size={10} />{c.name}{c.count > 1 && <span style={{ opacity: 0.7 }}>×{c.count}</span>}
                    </span>
                  ))}
                  {sum.skills.map((sk) => (
                    <span key={sk.name} className="pill" style={{ color: 'var(--node-test)', background: 'var(--node-test-soft)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      <Icon name="sparkles" size={10} />{sk.name}{sk.count > 1 && <span style={{ opacity: 0.7 }}>×{sk.count}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="eyebrow" style={{ marginBottom: 10 }}>Tools used · {sum.byTool.length}</div>
            {sum.byTool.length
              ? (
                <>
                  <HBars
                    items={toolItems}
                    valueKey="totalBytes"
                    labelKey="name"
                    fmt={(v) => fmtTok(v)}
                    color={(it) => (Number(it.totalBytes) > 60000 ? 'var(--error)' : Number(it.totalBytes) > 20000 ? 'var(--warn)' : 'var(--node-code)')}
                  />
                  <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>bar = result tokens returned</div>
                </>
              )
              : <div className="muted" style={{ fontSize: 11.5 }}>No tool calls recorded.</div>}

            {sum.filesTouched.length > 0 && (
              <>
                <div className="eyebrow" style={{ margin: '20px 0 10px' }}>Files touched · {sum.filesTouched.length}</div>
                <div className="col gap-5">
                  {sum.filesTouched.slice(0, 10).map((f) => (
                    <div key={f.path} className="row gap-8">
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left', flex: 1 }} title={f.path}>{f.path}</span>
                      <span className="mono tabular muted" style={{ fontSize: 10, flexShrink: 0 }}>×{f.ops}</span>
                      <span className="pill" style={{ fontSize: 9.5, flexShrink: 0 }}>{f.lastOp}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sum.durationMs > 0 && (
              <div className="row gap-8" style={{ marginTop: 20 }}>
                <Icon name="clock" size={12} style={{ color: 'var(--text-muted)' }} />
                <span className="muted" style={{ fontSize: 11 }}>duration</span>
                <span className="mono tabular" style={{ fontSize: 11.5 }}>{fmtDuration(sum.durationMs)}</span>
              </div>
            )}
          </>
        );
      }}
    </Module>
  );
}

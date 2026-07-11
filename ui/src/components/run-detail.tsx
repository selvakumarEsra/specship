/**
 * Run detail — one workflow execution's node progression, live event
 * stream, gate actions, and artifacts. Ported from the design bundle's
 * RunDetail (specs/specship-desktop/screens-workflows.jsx) onto live
 * /api/workflows/runs/:id data + its SSE event stream (REQ-DESKTOP-023).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api, runEventsUrl,
  type RunArtifact, type RunEvent, type WorkflowDagNode, type WorkflowRun,
} from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from './icons';
import { StatePill } from './ui';

// `rejected` is parked (resumable) but emits no events until resumed, so it
// counts as settled for polling purposes.
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'rejected']);

/** stepId lives inside `data` (the executor stamps it there, not the column). */
export function eventStepId(e: RunEvent): string | undefined {
  return e.stepId ?? (typeof e.data?.stepId === 'string' ? e.data.stepId : undefined);
}

export interface NodeView {
  id: string;
  kind: string;
  state: string;
  costUsd?: number;
}

/**
 * Kahn topological order over the definition's `depends_on` edges; falls
 * back to definition order if the graph is cyclic (executor refuses those
 * anyway).
 */
export function topoOrder(nodes: WorkflowDagNode[]): WorkflowDagNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const inDeg = new Map(nodes.map((n) => [n.id, (n.depends_on ?? []).filter((d) => ids.has(d)).length]));
  const out = new Map<string, string[]>();
  for (const n of nodes) for (const d of n.depends_on ?? []) {
    if (ids.has(d)) out.set(d, [...(out.get(d) ?? []), n.id]);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id);
  const order: WorkflowDagNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const next of out.get(id) ?? []) {
      const d = inDeg.get(next)! - 1;
      inDeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order.length === nodes.length ? order : nodes;
}

/**
 * Per-node view state: persisted `metadata.nodeStates` seeds it, then the
 * event log replays over the top (SSE keeps it live). Per-node cost comes
 * from `step_completed.data.stats` (absent on pre-stats runs — renders
 * without cost, never breaks).
 */
export function deriveNodeViews(
  defNodes: WorkflowDagNode[] | undefined,
  run: WorkflowRun | null,
  events: RunEvent[],
): NodeView[] {
  const persisted = (run?.metadata?.nodeStates ?? {}) as Record<string, string>;
  const kinds = new Map<string, string>();
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (id: string, kind?: string) => {
    if (!seen.has(id)) { seen.add(id); ordered.push(id); }
    if (kind && !kinds.get(id)) kinds.set(id, kind);
  };
  if (defNodes?.length) {
    for (const n of topoOrder(defNodes)) push(n.id, n.kind);
  } else {
    // Definition missing (deleted / renamed) — reconstruct from what ran.
    for (const id of Object.keys(persisted)) push(id);
    for (const e of events) { const id = eventStepId(e); if (id) push(id, typeof e.data?.stepKind === 'string' ? e.data.stepKind : undefined); }
  }

  const states = new Map<string, string>(ordered.map((id) => [id, persisted[id] ?? 'pending']));
  const costs = new Map<string, number>();
  for (const e of events) {
    const id = eventStepId(e);
    if (!id || !seen.has(id)) continue;
    if (e.eventType === 'step_started') states.set(id, 'running');
    else if (e.eventType === 'step_completed') states.set(id, 'completed');
    else if (e.eventType === 'step_failed') states.set(id, 'failed');
    else if (e.eventType === 'step_skipped') states.set(id, 'skipped');
    if (e.eventType === 'step_completed') {
      const stats = e.data?.stats as { costUsd?: number } | undefined;
      if (typeof stats?.costUsd === 'number') costs.set(id, stats.costUsd);
    }
  }
  // A paused run's gate node shows as paused, not pending.
  const approval = run?.metadata?.approval as { nodeId?: string } | undefined;
  if (run?.status === 'paused' && approval?.nodeId && states.get(approval.nodeId) !== 'completed') {
    states.set(approval.nodeId, 'paused');
  }
  return ordered.map((id) => ({
    id,
    kind: kinds.get(id) ?? 'prompt',
    state: states.get(id) ?? 'pending',
    costUsd: costs.get(id),
  }));
}

/** Run-total cost + model, summed/picked from `step_completed` stats. */
export function runTotals(events: RunEvent[]): { costUsd: number | null; model: string | null } {
  let cost: number | null = null;
  let model: string | null = null;
  for (const e of events) {
    if (e.eventType !== 'step_completed') continue;
    const stats = e.data?.stats as { costUsd?: number; model?: string } | undefined;
    if (typeof stats?.costUsd === 'number') cost = (cost ?? 0) + stats.costUsd;
    if (typeof stats?.model === 'string' && !model) model = stats.model;
  }
  return { costUsd: cost, model };
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

export function fmtCost(v: number | null | undefined): string {
  return typeof v === 'number' ? '$' + v.toFixed(2) : '—';
}

const NODE_STATE_COLOR: Record<string, string> = {
  pending: 'var(--text-muted)', running: 'var(--info)', completed: 'var(--success)',
  failed: 'var(--error)', paused: 'var(--warn)', skipped: 'var(--text-muted)',
};

/** Topological stepper — one chip per node, colored by live state. */
function RunNodeGraph({ nodes }: { nodes: NodeView[] }) {
  return (
    <div className="row" style={{ gap: 6, padding: '14px 16px', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-canvas-2)' }}>
      {nodes.map((n, i) => {
        const c = NODE_STATE_COLOR[n.state] ?? 'var(--text-muted)';
        return (
          <div key={n.id} className="row" style={{ gap: 6, alignItems: 'center' }}>
            {i > 0 && <Icon name="arrowRight" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
            <div
              data-node-id={n.id}
              data-node-state={n.state}
              className="row gap-8"
              style={{
                padding: '5px 11px', borderRadius: 8, background: n.state === 'running' ? 'var(--info-soft)' : 'var(--bg-panel)',
                border: `1.5px ${n.state === 'skipped' ? 'dotted' : 'solid'} ${n.state === 'pending' ? 'var(--border-subtle)' : c}`,
                opacity: n.state === 'pending' ? 0.65 : 1,
              }}
            >
              <span style={{ width: 16, height: 16, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                background: n.state === 'completed' ? 'var(--success)' : n.state === 'failed' ? 'var(--error)' : n.state === 'paused' ? 'var(--warn)' : 'transparent',
                border: n.state === 'completed' || n.state === 'failed' || n.state === 'paused' ? 'none' : `1.5px solid ${c}`,
                animation: n.state === 'running' ? 'spin 1.4s linear infinite' : 'none',
                borderTopColor: n.state === 'running' ? 'transparent' : undefined }}
              >
                {n.state === 'completed' && <Icon name="check" size={10} style={{ color: '#fff' }} />}
                {n.state === 'failed' && <Icon name="x" size={10} style={{ color: '#fff' }} />}
                {n.state === 'paused' && <Icon name="pause" size={9} style={{ color: '#fff' }} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>{n.id}</div>
                <div className="mono muted" style={{ fontSize: 9 }}>
                  {n.kind}{n.costUsd !== undefined && <span className="tabular"> · {fmtCost(n.costUsd)}</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const EV_COLOR: Record<string, string> = {
  step_started: 'var(--info)', step_completed: 'var(--success)', step_failed: 'var(--error)',
  step_skipped: 'var(--text-muted)', tool_called: 'var(--node-code)', agent_message: 'var(--text-secondary)',
  artifact_created: 'var(--node-route)', approval_requested: 'var(--warn)', approval_granted: 'var(--success)',
  approval_rejected: 'var(--error)', run_started: 'var(--info)', run_completed: 'var(--success)',
  run_failed: 'var(--error)', run_cancelled: 'var(--text-muted)', run_paused: 'var(--warn)',
};

/** One-line human summary of an event's payload. */
export function eventText(e: RunEvent): string {
  const d = e.data ?? {};
  if (typeof d.name === 'string') return d.name + (typeof d.input === 'string' && d.input ? ` · ${d.input}` : '');
  if (typeof d.text === 'string') return d.text;
  if (typeof d.error === 'string') return d.error;
  if (typeof d.message === 'string') return d.message;
  if (typeof d.reason === 'string') return d.reason;
  if (e.eventType === 'step_completed') {
    const stats = d.stats as { costUsd?: number } | undefined;
    return typeof stats?.costUsd === 'number' ? fmtCost(stats.costUsd) : '';
  }
  return '';
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

/** Scrolling event log; sticks to the tail unless the user scrolls away. */
function RunEventStream({ events, live }: { events: RunEvent[]; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  useEffect(() => {
    if (stuck && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length, stuck]);
  return (
    <div
      ref={ref}
      className="scroll-y"
      aria-live="polite"
      onScroll={(e) => { const el = e.currentTarget; setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 30); }}
      style={{ flex: 1, padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}
    >
      {events.map((ev) => (
        <div key={ev.id} className="row gap-10" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="muted tabular" style={{ flexShrink: 0, width: 70 }}>{fmtClock(ev.createdAt)}</span>
          <span style={{ color: EV_COLOR[ev.eventType] ?? 'var(--text-secondary)', width: 140, flexShrink: 0 }}>{ev.eventType}</span>
          <span className="muted" style={{ flexShrink: 0, width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eventStepId(ev) ?? ''}</span>
          <span className="secondary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eventText(ev)}</span>
        </div>
      ))}
      {!events.length && <div className="muted" style={{ padding: '8px 0' }}>No events yet.</div>}
      {live && (
        <div className="row gap-6 muted" style={{ padding: '6px 0' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--info)', animation: 'skeleton 1s infinite' }} />
          streaming…
        </div>
      )}
    </div>
  );
}

/** Artifact list + body viewer (completed nodes' outputs, read from disk). */
function ArtifactsPanel({ artifacts, loading }: { artifacts: RunArtifact[]; loading: boolean }) {
  const [sel, setSel] = useState(0);
  const current = artifacts[Math.min(sel, artifacts.length - 1)];
  if (loading) return <div className="muted" style={{ padding: 16, fontSize: 12 }}>Loading artifacts…</div>;
  if (!artifacts.length) return <div className="muted" style={{ padding: 16, fontSize: 12 }}>No artifacts — only completed nodes write output files.</div>;
  return (
    <div className="row" style={{ flex: 1, minHeight: 0 }}>
      <div className="scroll-y" style={{ width: 190, borderRight: '1px solid var(--border-subtle)', padding: 8, flexShrink: 0 }}>
        {artifacts.map((a, i) => (
          <div
            key={a.name}
            role="button"
            tabIndex={0}
            onClick={() => setSel(i)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(i); } }}
            className="row gap-8 list-row"
            style={{ padding: '7px 9px', borderRadius: 6, cursor: 'pointer', background: sel === i ? 'var(--bg-hover)' : 'transparent' }}
          >
            <Icon name="box" size={13} style={{ color: 'var(--node-route)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
              <div className="muted" style={{ fontSize: 9.5 }}>{a.nodeId}{a.outputType ? ' · ' + a.outputType : ''}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="scroll-y" style={{ flex: 1, padding: 16 }}>
        <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{current?.body}</pre>
      </div>
    </div>
  );
}

// @implements REQ-DESKTOP-023
export function RunDetail({ id, project }: { id: string; project: string | null }) {
  const detail = useApi(() => api.run(id, project), [id, project]);
  const workflows = useApi(() => api.workflows(project), [project]);
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);
  const [tab, setTab] = useState<'events' | 'artifacts'>('events');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = detail.data?.run ?? null;
  const status = run?.status ?? '';
  const isLive = !!run && !TERMINAL.has(status);

  // Merge the fetched log with the SSE tail (dedup by event id).
  const events = useMemo(() => {
    const base = detail.data?.events ?? [];
    const seen = new Set(base.map((e) => e.id));
    return [...base, ...liveEvents.filter((e) => !seen.has(e.id))];
  }, [detail.data, liveEvents]);

  // Live tail: subscribe while the run is non-terminal; the server closes
  // the stream with a `done` frame on terminal state → refetch the run.
  const lastFetchedId = detail.data?.events.length ? detail.data.events[detail.data.events.length - 1]!.id : 0;
  const reloadRun = detail.reload;
  useEffect(() => {
    if (!isLive || typeof EventSource === 'undefined') return;
    const es = new EventSource(runEventsUrl(id, lastFetchedId, project));
    const onEvent = (msg: MessageEvent) => {
      try {
        const e = JSON.parse(msg.data as string) as RunEvent;
        setLiveEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]));
      } catch { /* malformed frame — skip */ }
    };
    for (const t of Object.keys(EV_COLOR)) es.addEventListener(t, onEvent);
    es.addEventListener('done', () => { es.close(); reloadRun(); });
    es.onerror = () => { /* poll-based stream; the server ends it on terminal state */ };
    return () => es.close();
  }, [id, project, isLive, lastFetchedId, reloadRun]);

  const nodes = useMemo(() => {
    const def = workflows.data?.workflows.find((w) => w.workflow.name === run?.workflowName)?.workflow;
    return deriveNodeViews(def?.nodes, run, events);
  }, [workflows.data, run, events]);

  const totals = useMemo(() => runTotals(events), [events]);
  const startedAt = typeof run?.startedAt === 'number' ? run.startedAt : null;
  const endedAt = typeof run?.completedAt === 'number' ? run.completedAt
    : typeof run?.lastActivityAt === 'number' ? (run.lastActivityAt as number) : null;
  const duration = startedAt && endedAt ? endedAt - startedAt : null;

  const act = (fn: () => Promise<unknown>) => {
    setActionBusy(true);
    setActionError(null);
    fn().then(
      () => { setActionBusy(false); setRejecting(false); setLiveEvents([]); detail.reload(); },
      (e) => { setActionBusy(false); setActionError(e instanceof Error ? e.message : String(e)); },
    );
  };
  // Engine convention: approve only transitions state; resume drives the
  // next step — chain both so the run actually advances (A2).
  const approve = () => act(async () => {
    await api.runAction(id, 'approve', undefined, project);
    await api.runAction(id, 'resume', undefined, project);
  });
  const reject = () => act(() => api.runAction(id, 'reject', rejectReason.trim() ? { reason: rejectReason.trim() } : undefined, project));
  const cancel = () => act(() => api.runAction(id, 'cancel', undefined, project));
  // Revise loop (WF-REJECT-DOC): resume a rejected run — the gate's on_reject
  // prompt runs with the reviewer's feedback, then re-pauses at the gate.
  const resumeRevise = () => act(() => api.runAction(id, 'resume', undefined, project));
  const purge = () => act(() => api.runAction(id, 'purge', undefined, project));

  const artifacts = useApi(
    () => (tab === 'artifacts' ? api.runArtifacts(id, project) : Promise.resolve({ artifacts: [] })),
    [id, project, tab, status],
  );

  const approval = run?.metadata?.approval as { message?: string } | undefined;

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div className="row gap-10" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => go('runs')}>
          <Icon name="chevronLeft" size={14} />Runs
        </button>
        <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{run?.workflowName ?? '…'}</span>
        <span className="mono muted" style={{ fontSize: 11.5 }}>{id}</span>
        {run && <StatePill state={status} />}
        <span className="grow" />
        <span className="mono muted tabular" style={{ fontSize: 11.5 }} title="Duration">
          <Icon name="clock" size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{fmtDuration(duration)}
        </span>
        {totals.costUsd !== null && (
          <span className="mono tabular" style={{ fontSize: 11.5 }} title="Run-total cost">{fmtCost(totals.costUsd)}</span>
        )}
        {totals.model && <span className="mono muted" style={{ fontSize: 11.5 }} title="Model">{totals.model}</span>}
        {(status === 'running' || status === 'paused') && (
          <button className="btn btn-destructive btn-sm" onClick={cancel} disabled={actionBusy}>
            <Icon name="cancel" size={12} />Cancel
          </button>
        )}
        {status === 'completed' && (
          <button className="btn btn-secondary btn-sm" onClick={() => setTab('artifacts')}>
            <Icon name="box" size={12} />Inspect artifacts
          </button>
        )}
      </div>

      {status === 'failed' && run?.errorMessage && (
        <div className="row gap-12" style={{ padding: '12px 16px', background: 'var(--error-soft)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ color: 'var(--error)', flexShrink: 0 }}><Icon name="cancel" size={16} /></span>
          <div className="grow">
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--error)' }}>Run failed</div>
            <div className="secondary mono" style={{ fontSize: 12, marginTop: 1, whiteSpace: 'pre-wrap' }}>{run.errorMessage}</div>
          </div>
        </div>
      )}

      {status === 'rejected' && (
        <div className="row gap-12" style={{ padding: '12px 16px', background: 'var(--warn-soft)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--warn)', flexShrink: 0 }}><Icon name="drift" size={18} /></span>
          <div className="grow" style={{ minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Rejected — parked with worktree and artifacts kept</div>
            <div className="secondary" style={{ fontSize: 12, marginTop: 1 }}>
              {run?.errorMessage ?? 'Rejected at the approval gate.'}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setTab('artifacts')}>Inspect artifacts</button>
          <button className="btn btn-destructive btn-sm" onClick={purge} disabled={actionBusy}
            title="Removes the worktree — the only destructive action. Artifacts and the run record are kept.">
            Purge worktree
          </button>
          <button className="btn btn-primary btn-sm" onClick={resumeRevise} disabled={actionBusy}
            title="Runs the gate's on_reject revise prompt with your feedback, then re-pauses for review.">
            <Icon name="circle" size={12} />Resume &amp; revise
          </button>
        </div>
      )}

      {status === 'paused' && (
        <div className="row gap-12" style={{ padding: '12px 16px', background: 'var(--warn-soft)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--warn)', flexShrink: 0 }}><Icon name="pause" size={18} /></span>
          <div className="grow" style={{ minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Approval required</div>
            <div className="secondary" style={{ fontSize: 12, marginTop: 1 }}>{approval?.message ?? 'The run paused at an approval gate.'}</div>
          </div>
          {rejecting ? (
            <>
              <input
                className="input"
                autoFocus
                placeholder="Reason (optional)…"
                aria-label="Rejection reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                style={{ width: 200 }}
              />
              <button className="btn btn-destructive btn-sm" onClick={reject} disabled={actionBusy}>Confirm reject</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(false)}>Back</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setTab('artifacts')}>Inspect artifacts</button>
              <button className="btn btn-destructive btn-sm" onClick={() => setRejecting(true)} disabled={actionBusy}>Reject</button>
              <button className="btn btn-primary btn-sm" onClick={approve} disabled={actionBusy}>
                <Icon name="check" size={13} />Approve
              </button>
            </>
          )}
        </div>
      )}

      {actionError && (
        <div className="row gap-8" style={{ padding: '8px 16px', background: 'var(--error-soft)', color: 'var(--error)', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="cancel" size={13} style={{ flexShrink: 0 }} />
          <span>{actionError}</span>
        </div>
      )}

      {nodes.length > 0 && <RunNodeGraph nodes={nodes} />}

      <div className="col" style={{ flex: 1, minHeight: 0 }}>
        <div className="row gap-2" style={{ padding: '8px 14px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          {(['events', 'artifacts'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '7px 13px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, textTransform: 'capitalize',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`, marginBottom: -1,
              }}
            >
              {t}
              {t === 'events' && isLive && (
                <span className="pill" style={{ marginLeft: 6, fontSize: 9, background: 'var(--info-soft)', color: 'var(--info)' }}>live</span>
              )}
            </button>
          ))}
        </div>
        {tab === 'events' && <RunEventStream events={events} live={isLive} />}
        {tab === 'artifacts' && <ArtifactsPanel artifacts={artifacts.data?.artifacts ?? []} loading={artifacts.loading} />}
      </div>
    </div>
  );
}

/**
 * Run detail — live workflow run inspector.
 *
 * On mount, fetch the run + initial event history, then open an SSE
 * connection to /api/workflows/runs/:id/events. The server tails the
 * workflow_events table; we merge any newly-id-ed events into the local
 * signal so the timeline updates in real time.
 *
 * Actions (approve / reject / cancel / resume) hit the matching POST
 * endpoint and re-fetch the run.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { ProjectsService } from '../../api/projects';
import { StatePill } from '../../ui/state-pill';
import { Icon } from '../../shell/icon/icon';
import type { RunDetailResponse, WorkflowEvent, WorkflowRun } from '../../api/types';

type RunStatus = WorkflowRun['status'];

// ── DAG node / edge types ──────────────────────────────────────────────────

interface DagNode {
  id: string;
  label: string;
  kind: string;
  /** status derived from events */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'skipped';
  /** layout coords in DAG_W × DAG_H space */
  x: number;
  y: number;
}

interface DagEdge {
  from: string;
  to: string;
}

// ── Tab config ─────────────────────────────────────────────────────────────

export interface TabConfig { id: string; label: string; }

// ── event colour map (mirrors design EV_COLOR) ────────────────────────────

const EV_COLOR: Record<string, string> = {
  step_started: 'var(--info)',
  step_completed: 'var(--success)',
  tool_called: 'var(--node-code)',
  agent_message: 'var(--node-spec)',
  artifact_created: 'var(--node-route)',
  approval_requested: 'var(--warn)',
  run_started: 'var(--info)',
  run_completed: 'var(--success)',
  run_failed: 'var(--error)',
  run_cancelled: 'var(--text-muted)',
  run_paused: 'var(--warn)',
};

@Component({
  selector: 'app-run-detail',
  imports: [StatePill, Icon],
  templateUrl: './run-detail.html',
  styleUrl: './run-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunDetail implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ── Core signals (backend wiring preserved) ──────────────────────────────
  protected readonly runId = signal<string>('');
  protected readonly run = signal<WorkflowRun | null>(null);
  protected readonly events = signal<WorkflowEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly streamStatus = signal<'connecting' | 'live' | 'closed' | 'error'>('connecting');
  protected readonly actionPending = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  private closeStream: (() => void) | null = null;

  protected readonly status = computed<RunStatus | null>(() => this.run()?.status ?? null);
  protected readonly isTerminal = computed(() => {
    const s = this.status();
    return s === 'completed' || s === 'failed' || s === 'cancelled';
  });

  protected readonly approvalPending = computed(() => {
    const last = [...this.events()].reverse().find(
      (e) => e.eventType === 'approval_requested' || e.eventType === 'approval_granted' || e.eventType === 'approval_rejected',
    );
    return last?.eventType === 'approval_requested';
  });

  // ── Tab state ────────────────────────────────────────────────────────────
  readonly TABS: TabConfig[] = [
    { id: 'events', label: 'Events' },
    { id: 'artifacts', label: 'Artifacts' },
    { id: 'cost', label: 'Cost' },
  ];
  protected readonly activeTab = signal<string>('events');

  // ── DAG layout constants ─────────────────────────────────────────────────
  readonly DAG_W = 920;
  readonly DAG_H = 180;

  /**
   * Build DAG nodes from the workflow definition nodes list (on the run).
   * The WorkflowRun.metadata may carry `dag` info — fall back to steps
   * derived from events.
   */
  protected readonly dagNodes = computed<DagNode[]>(() => {
    const r = this.run();
    // Derive step ids + statuses from the events
    const stepStatusMap = this.stepStatusMap();

    // If the run has metadata.nodes use those for layout; otherwise build from steps
    const metaNodes = r?.metadata?.['nodes'] as Array<{ id: string; kind?: string }> | undefined;
    if (metaNodes?.length) {
      const cols = this.layoutCols(metaNodes.map((n) => n.id));
      return metaNodes.map((n, i) => {
        const col = cols[i] ?? i;
        return {
          id: n.id,
          label: n.id,
          kind: n.kind ?? 'agent',
          status: stepStatusMap[n.id] ?? 'pending',
          x: col * 160 + 20,
          y: 72,
        };
      });
    }

    // Fall back: unique step ids from events, auto-laid out in a row
    const stepIds = [...new Set(
      this.events()
        .map((e) => (e.data?.['stepId'] as string | undefined) ?? e.stepId ?? '')
        .filter(Boolean),
    )];
    if (!stepIds.length) return [];
    const spacing = Math.min(160, (this.DAG_W - 40) / Math.max(stepIds.length, 1));
    return stepIds.map((id, i) => ({
      id,
      label: id,
      kind: (this.events().find((e) => ((e.data?.['stepId'] as string | undefined) ?? e.stepId) === id)?.stepKind) ?? 'step',
      status: stepStatusMap[id] ?? 'pending',
      x: i * spacing + 20,
      y: 72,
    }));
  });

  protected readonly dagEdges = computed<DagEdge[]>(() => {
    const r = this.run();
    const metaEdges = r?.metadata?.['edges'] as Array<{ from: string; to: string }> | undefined;
    if (metaEdges?.length) return metaEdges;
    // Auto-chain nodes sequentially
    const nodes = this.dagNodes();
    return nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id }));
  });

  protected readonly nodeMap = computed<Record<string, DagNode>>(() => {
    const m: Record<string, DagNode> = {};
    for (const n of this.dagNodes()) m[n.id] = n;
    return m;
  });

  protected readonly selectedNode = signal<string>('');

  // ── Derived step-status map from events ─────────────────────────────────
  private readonly stepStatusMap = computed<Record<string, DagNode['status']>>(() => {
    const m: Record<string, DagNode['status']> = {};
    for (const e of this.events()) {
      const sid = (e.data?.['stepId'] as string | undefined) ?? e.stepId ?? '';
      if (!sid) continue;
      switch (e.eventType) {
        case 'step_started': m[sid] = 'running'; break;
        case 'step_completed': m[sid] = 'completed'; break;
        case 'step_failed': m[sid] = 'failed'; break;
        case 'step_skipped': m[sid] = 'skipped'; break;
      }
    }
    // If run is paused, last running step is paused
    if (this.status() === 'paused') {
      for (const id of Object.keys(m)) {
        if (m[id] === 'running') m[id] = 'paused';
      }
    }
    return m;
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    if (!id) {
      this.error.set('No run id');
      this.loading.set(false);
      return;
    }
    this.runId.set(id);
    void this.bootstrap(id);
  }

  ngOnDestroy(): void {
    this.closeStream?.();
    this.closeStream = null;
  }

  private async bootstrap(id: string): Promise<void> {
    try {
      const data = await this.api.get<RunDetailResponse>(
        `/api/workflows/runs/${encodeURIComponent(id)}${this.projects.projectQuery()}`,
      );
      this.run.set(data.run);
      this.events.set(data.events ?? []);
      this.loading.set(false);
      if (!this.isTerminal()) this.openStream(id);
      else this.streamStatus.set('closed');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.loading.set(false);
    }
  }

  private openStream(id: string): void {
    this.streamStatus.set('connecting');
    const close = this.api.openEventStream(
      `/api/workflows/runs/${encodeURIComponent(id)}/events${this.projects.projectQuery()}`,
      (type, payload) => {
        if (type === 'done') {
          this.streamStatus.set('closed');
          void this.refreshRun();
          return;
        }
        const ev = payload as Partial<WorkflowEvent> | null;
        if (!ev || typeof ev !== 'object' || ev.id == null) return;
        this.streamStatus.set('live');
        this.appendEvent(ev as WorkflowEvent);
        if (type.startsWith('run_')) void this.refreshRun();
      },
      () => { this.streamStatus.set('error'); },
    );
    this.closeStream = close;
    this.destroyRef.onDestroy(() => close());
  }

  private appendEvent(ev: WorkflowEvent): void {
    this.events.update((arr) => {
      if (arr.some((e) => e.id === ev.id)) return arr;
      const next = [...arr, ev];
      next.sort((a, b) => a.id - b.id);
      return next;
    });
  }

  private async refreshRun(): Promise<void> {
    try {
      const id = this.runId();
      if (!id) return;
      const data = await this.api.get<RunDetailResponse>(
        `/api/workflows/runs/${encodeURIComponent(id)}${this.projects.projectQuery()}`,
      );
      this.run.set(data.run);
    } catch { /* leave stale */ }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  protected async approve(): Promise<void> { await this.action('approve'); }
  protected async reject(): Promise<void> {
    const reason = prompt('Reason for rejecting?') ?? undefined;
    await this.action('reject', reason ? { reason } : undefined);
  }
  protected async cancel(): Promise<void> {
    if (!confirm('Cancel this run?')) return;
    await this.action('cancel');
  }
  protected async resume(): Promise<void> { await this.action('resume'); }

  private async action(kind: 'approve' | 'reject' | 'cancel' | 'resume', body?: unknown): Promise<void> {
    this.actionPending.set(kind);
    this.actionError.set(null);
    try {
      await this.api.post(
        `/api/workflows/runs/${encodeURIComponent(this.runId())}/${kind}${this.projects.projectQuery()}`,
        body ?? {},
      );
      await this.refreshRun();
      if ((kind === 'resume' || kind === 'approve') && !this.isTerminal() && !this.closeStream) {
        this.openStream(this.runId());
      }
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.actionPending.set(null);
    }
  }

  // ── Formatters ───────────────────────────────────────────────────────────
  protected fmtTime(ts: number | null | undefined): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString();
  }

  protected fmtDuration(start?: number | null, end?: number | null): string {
    if (!start) return '—';
    const e = end ?? Date.now();
    const ms = e - start;
    if (ms >= 60_000) return Math.round(ms / 60_000) + 'm ' + Math.round((ms % 60_000) / 1000) + 's';
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return ms + 'ms';
  }

  protected eventDetail(e: WorkflowEvent): string {
    const d = e.data;
    if (!d) return '';
    const cap = (s: string) => (s.length > 200 ? s.slice(0, 200) + '…' : s);
    if (typeof d['error'] === 'string') return d['error'] as string;
    // agent_message — the agent's text turn.
    if (typeof d['text'] === 'string') return cap(d['text'] as string);
    // tool_called — tool name + short input summary.
    if (typeof d['name'] === 'string') {
      const input = typeof d['input'] === 'string' ? (d['input'] as string) : '';
      return cap(input ? `${d['name']} ${input}` : (d['name'] as string));
    }
    const out = d['output'];
    if (typeof out === 'string') return cap(out);
    if (out != null) {
      try { return cap(JSON.stringify(out)); } catch { return ''; }
    }
    return '';
  }

  protected stepIdOf(e: WorkflowEvent): string {
    return (e.data?.['stepId'] as string | undefined) ?? e.stepId ?? '';
  }

  protected evColor(eventType: string): string {
    return EV_COLOR[eventType] ?? 'var(--text-secondary)';
  }

  protected back(): void { void this.router.navigate(['/runs']); }

  // ── DAG helpers ──────────────────────────────────────────────────────────

  /** SVG cubic bezier path between two nodes */
  edgePath(a: DagNode, b: DagNode): string {
    const ax = a.x + 150, ay = a.y + 18;
    const bx = b.x, by = b.y + 18;
    const mx = (ax + bx) / 2;
    return `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
  }

  nodeBorderColor(n: DagNode): string {
    if (this.selectedNode() === n.id) return 'var(--accent)';
    if (n.status === 'pending' || n.status === 'skipped') return 'var(--border-subtle)';
    const c: Record<string, string> = {
      running: 'var(--info)', completed: 'var(--success)',
      failed: 'var(--error)', paused: 'var(--warn)',
    };
    return c[n.status] ?? 'var(--border-subtle)';
  }

  nodeBoxShadow(n: DagNode): string {
    if (n.status === 'running') return '0 0 0 3px var(--info-soft)';
    if (this.selectedNode() === n.id) return '0 4px 14px rgba(0,0,0,0.4)';
    return 'none';
  }

  nodeDotBg(n: DagNode): string {
    if (n.status === 'completed') return 'var(--success)';
    if (n.status === 'failed') return 'var(--error)';
    if (n.status === 'paused') return 'var(--warn)';
    return 'transparent';
  }

  nodeDotBorder(n: DagNode): string {
    if (n.status === 'pending' || n.status === 'running' || n.status === 'skipped') {
      const c: Record<string, string> = {
        pending: 'var(--text-muted)', running: 'var(--info)', skipped: 'var(--text-muted)',
      };
      return `1.5px solid ${c[n.status]}`;
    }
    return 'none';
  }

  /** Distribute node ids into columns (simple sequential layout) */
  private layoutCols(ids: string[]): number[] {
    return ids.map((_, i) => i);
  }
}

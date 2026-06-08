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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { ProjectsService } from '../../api/projects';
import type { RunDetailResponse, WorkflowEvent, WorkflowRun } from '../../api/types';

type RunStatus = WorkflowRun['status'];

interface StepRow {
  id: string;
  kind?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  endedAt?: number;
  output?: unknown;
  error?: string;
}

@Component({
  selector: 'app-run-detail',
  imports: [RouterLink, JsonPipe],
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

  // Derive per-step rows from the event log.
  protected readonly steps = computed<StepRow[]>(() => {
    const rows = new Map<string, StepRow>();
    for (const e of this.events()) {
      const sid = (e.data?.['stepId'] as string | undefined) ?? e.stepId ?? '';
      if (!sid) continue;
      if (!rows.has(sid)) rows.set(sid, { id: sid, status: 'pending' });
      const r = rows.get(sid)!;
      if (e.eventType === 'step_started') {
        r.status = 'running';
        r.startedAt = e.createdAt;
        r.kind = (e.data?.['kind'] as string | undefined) ?? r.kind;
      } else if (e.eventType === 'step_completed') {
        r.status = 'completed';
        r.endedAt = e.createdAt;
        r.output = e.data?.['output'];
      } else if (e.eventType === 'step_failed') {
        r.status = 'failed';
        r.endedAt = e.createdAt;
        r.error = (e.data?.['error'] as string | undefined) ?? 'failed';
      } else if (e.eventType === 'step_skipped') {
        r.status = 'skipped';
        r.endedAt = e.createdAt;
      }
    }
    return Array.from(rows.values());
  });

  protected readonly approvalPending = computed(() => {
    const last = [...this.events()].reverse().find((e) => e.eventType === 'approval_requested' || e.eventType === 'approval_granted' || e.eventType === 'approval_rejected');
    return last?.eventType === 'approval_requested';
  });

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
      const data = await this.api.get<RunDetailResponse>(`/api/workflows/runs/${encodeURIComponent(id)}${this.projects.projectQuery()}`);
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
        // Server sends the full WorkflowEvent row as data for every event type.
        const ev = payload as Partial<WorkflowEvent> | null;
        if (!ev || typeof ev !== 'object' || ev.id == null) return;
        this.streamStatus.set('live');
        this.appendEvent(ev as WorkflowEvent);
        // Run-level events update the run snapshot too.
        if (type.startsWith('run_')) void this.refreshRun();
      },
      () => { this.streamStatus.set('error'); }
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
      const data = await this.api.get<RunDetailResponse>(`/api/workflows/runs/${encodeURIComponent(id)}${this.projects.projectQuery()}`);
      this.run.set(data.run);
    } catch { /* leave stale */ }
  }

  // --- Actions --------------------------------------------------------------

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
      await this.api.post(`/api/workflows/runs/${encodeURIComponent(this.runId())}/${kind}${this.projects.projectQuery()}`, body ?? {});
      await this.refreshRun();
      // resume + approve may re-open the stream if the run resumes running.
      if ((kind === 'resume' || kind === 'approve') && !this.isTerminal() && !this.closeStream) {
        this.openStream(this.runId());
      }
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.actionPending.set(null);
    }
  }

  // --- Formatters -----------------------------------------------------------

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

  protected eventLabel(e: WorkflowEvent): string {
    const sid = (e.data?.['stepId'] as string | undefined) ?? e.stepId ?? '';
    const map: Record<string, string> = {
      run_started: 'Run started',
      run_completed: 'Run completed',
      run_failed: 'Run failed',
      run_cancelled: 'Run cancelled',
      run_paused: 'Run paused',
      step_started: `Step started · ${sid}`,
      step_completed: `Step completed · ${sid}`,
      step_failed: `Step failed · ${sid}`,
      step_skipped: `Step skipped · ${sid}`,
      tool_called: `Tool called · ${(e.data?.['tool'] as string | undefined) ?? '?'}`,
      artifact_created: `Artifact · ${(e.data?.['name'] as string | undefined) ?? '?'}`,
      approval_requested: 'Approval requested',
      approval_granted: 'Approval granted',
      approval_rejected: 'Approval rejected',
    };
    return map[e.eventType] ?? e.eventType;
  }

  protected eventDetail(e: WorkflowEvent): string {
    if (!e.data) return '';
    const out = e.data['output'];
    const err = e.data['error'];
    if (typeof err === 'string') return err;
    if (typeof out === 'string') return out.length > 200 ? out.slice(0, 200) + '…' : out;
    if (out != null) {
      try {
        const s = JSON.stringify(out);
        return s.length > 200 ? s.slice(0, 200) + '…' : s;
      } catch { return ''; }
    }
    return '';
  }

  protected back(): void { void this.router.navigate(['/runs']); }
}

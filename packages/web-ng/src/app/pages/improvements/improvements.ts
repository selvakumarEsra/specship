/**
 * Improvements page (REQ-REFLECT-007 surface).
 *
 * Lists open reflection proposals — durable self-improvement suggestions mined
 * from the ingested transcripts — with their severity and evidence. Each
 * proposal can be previewed (a non-mutating diff of the exact file change),
 * applied (preview-diff → confirm → write), undone, or dismissed. The "Analyze"
 * button triggers an on-demand reflection pass (REQ-REFLECT-006).
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import type {
  ReflectActionResponse,
  ReflectAnalyzeResponse,
  ReflectListResponse,
  ReflectPreview,
  ReflectProposal,
} from '../../api/types';

@Component({
  selector: 'app-improvements',
  imports: [PageHead, Pill, Icon],
  templateUrl: './improvements.html',
  styleUrl: './improvements.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Improvements {
  private readonly api = inject(ApiService);
  protected readonly resource = apiResource<ReflectListResponse>(this.api, () => '/api/reflect?state=open');

  /** Running the on-demand reflection pass. */
  protected readonly analyzing = signal(false);
  /** Per-hash preview content (null = loading). */
  protected readonly previews = signal<Record<string, ReflectPreview | null>>({});
  /** Hashes with an in-flight mutation. */
  protected readonly busy = signal<Set<string>>(new Set());
  /** Last action outcome per hash (for the inline status line). */
  protected readonly outcomes = signal<Record<string, string>>({});
  /** Transient error banner. */
  protected readonly errorMsg = signal<string | null>(null);

  protected readonly proposals = computed<ReflectProposal[]>(() => {
    const list = this.resource.state().data?.proposals ?? [];
    const sev: Record<string, number> = { high: 0, warn: 1, info: 2 };
    return [...list].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));
  });

  protected readonly counts = computed(() => {
    const list = this.resource.state().data?.proposals ?? [];
    return {
      high: list.filter((p) => p.severity === 'high').length,
      warn: list.filter((p) => p.severity === 'warn').length,
      info: list.filter((p) => p.severity === 'info').length,
    };
  });

  protected typeLabel(t: ReflectProposal['type']): string {
    return t === 'memory_rule' ? 'memory / rule' : t === 'skill' ? 'skill' : 'hook';
  }

  protected sevColor(sev: string): string {
    return sev === 'high' ? 'var(--error)' : sev === 'warn' ? 'var(--warn)' : 'var(--info)';
  }

  protected isBusy(hash: string): boolean {
    return this.busy().has(hash);
  }

  protected previewOf(hash: string): ReflectPreview | null | undefined {
    return this.previews()[hash];
  }

  protected outcomeOf(hash: string): string | undefined {
    return this.outcomes()[hash];
  }

  /** Run an on-demand reflection pass, then refresh the list. */
  protected async analyze(): Promise<void> {
    this.analyzing.set(true);
    this.errorMsg.set(null);
    try {
      await this.api.post<ReflectAnalyzeResponse>('/api/reflect/analyze', {});
      this.resource.refetch();
    } catch (err) {
      this.errorMsg.set(this.msg(err));
    } finally {
      this.analyzing.set(false);
    }
  }

  /** Toggle the preview diff for a proposal (fetches on first open). */
  protected async togglePreview(hash: string): Promise<void> {
    const cur = this.previews();
    if (hash in cur) {
      const next = { ...cur };
      delete next[hash];
      this.previews.set(next);
      return;
    }
    this.previews.set({ ...cur, [hash]: null });
    try {
      const preview = await this.api.get<ReflectPreview>(`/api/reflect/${hash}/preview`);
      this.previews.set({ ...this.previews(), [hash]: preview });
    } catch (err) {
      this.errorMsg.set(this.msg(err));
      const next = { ...this.previews() };
      delete next[hash];
      this.previews.set(next);
    }
  }

  protected applyProposal(hash: string): Promise<void> {
    return this.mutate(hash, `/api/reflect/${hash}/apply`, 'apply');
  }

  protected undoProposal(hash: string): Promise<void> {
    return this.mutate(hash, `/api/reflect/${hash}/undo`, 'undo');
  }

  protected dismissProposal(hash: string): Promise<void> {
    return this.mutate(hash, `/api/reflect/${hash}/dismiss`, 'dismiss');
  }

  private async mutate(hash: string, path: string, kind: 'apply' | 'undo' | 'dismiss'): Promise<void> {
    this.setBusy(hash, true);
    this.errorMsg.set(null);
    try {
      const res = await this.api.post<ReflectActionResponse>(path, {});
      const outcome = res.outcome ?? (res.ok ? 'dismissed' : 'done');
      this.outcomes.set({ ...this.outcomes(), [hash]: outcome });
      // apply/undo keep the row visible (state changes); dismiss removes it from
      // the open list. Either way, refetch reconciles with the server.
      this.resource.refetch();
    } catch (err) {
      this.errorMsg.set(`${kind} failed: ${this.msg(err)}`);
    } finally {
      this.setBusy(hash, false);
    }
  }

  private setBusy(hash: string, on: boolean): void {
    this.busy.update((s) => {
      const next = new Set(s);
      if (on) next.add(hash); else next.delete(hash);
      return next;
    });
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

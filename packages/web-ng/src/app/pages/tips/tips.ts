/** Tips page — full tip cards ordered by severity with snooze dropdown. */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { CopyBtn } from '../../ui/copy-btn';
import { Icon } from '../../shell/icon/icon';
import type { Tip, TipsResponse } from '../../api/types';

@Component({
  selector: 'app-tips',
  imports: [PageHead, Pill, CopyBtn, Icon],
  templateUrl: './tips.html',
  styleUrl: './tips.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Tips {
  private readonly api = inject(ApiService);
  protected readonly resource = apiResource<TipsResponse>(this.api, () => '/api/claude/tips');

  /** IDs of dismissed (snoozed) tips. */
  private readonly dismissedIds = signal(new Set<string>());
  /** IDs of tips with the snooze menu open. */
  private readonly snoozeOpenIds = signal(new Set<string>());

  protected readonly snoozeOpts = ['1 day', '1 week', 'Forever'];

  protected readonly ordered = computed<Tip[]>(() => {
    const tips = this.resource.state().data?.tips ?? [];
    const dismissed = this.dismissedIds();
    const sev: Record<string, number> = { error: 0, warn: 1, info: 2 };
    return [...tips]
      .filter((t) => !dismissed.has(t.id))
      .sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));
  });

  protected readonly counts = computed(() => {
    const tips = this.resource.state().data?.tips ?? [];
    return {
      error: tips.filter((t) => t.severity === 'error').length,
      warn: tips.filter((t) => t.severity === 'warn').length,
      info: tips.filter((t) => t.severity === 'info').length,
    };
  });

  protected isDismissed(id: string): boolean {
    return this.dismissedIds().has(id);
  }

  protected snoozeOpen(id: string): boolean {
    return this.snoozeOpenIds().has(id);
  }

  protected toggleSnooze(id: string): void {
    this.snoozeOpenIds.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected dismiss(id: string): void {
    this.dismissedIds.update((s) => new Set([...s, id]));
    this.snoozeOpenIds.update((s) => { const next = new Set(s); next.delete(id); return next; });
  }

  protected sevColor(sev: string): string {
    return sev === 'error' ? 'var(--error)' : sev === 'warn' ? 'var(--warn)' : 'var(--info)';
  }

  protected sevBg(sev: string): string {
    return sev === 'error' ? 'color-mix(in srgb, var(--error) 16%, transparent)'
      : sev === 'warn' ? 'color-mix(in srgb, var(--warn) 16%, transparent)'
      : 'color-mix(in srgb, var(--info) 16%, transparent)';
  }
}

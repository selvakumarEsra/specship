/** Tips page — full tip cards ordered by severity. */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import type { Tip, TipsResponse } from '../../api/types';

@Component({
  selector: 'app-tips',
  imports: [],
  templateUrl: './tips.html',
  styleUrl: './tips.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Tips {
  private readonly api = inject(ApiService);
  protected readonly resource = apiResource<TipsResponse>(this.api, () => '/api/claude/tips');

  protected readonly ordered = computed<Tip[]>(() => {
    const tips = this.resource.state().data?.tips ?? [];
    const sev: Record<string, number> = { error: 0, warn: 1, info: 2 };
    return [...tips].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));
  });

  protected readonly counts = computed(() => {
    const tips = this.resource.state().data?.tips ?? [];
    return {
      error: tips.filter((t) => t.severity === 'error').length,
      warn: tips.filter((t) => t.severity === 'warn').length,
      info: tips.filter((t) => t.severity === 'info').length,
    };
  });

  protected copy(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => { /* noop */ });
    }
  }
}

/** Compare projects — table + best-callout. */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import type { CompareResponse } from '../../api/types';

interface Row {
  id: string;
  name: string;
  sessions: number;
  cost: number;
  avgCost: number;
  cacheHit: number;
  prompts: number;
}

@Component({
  selector: 'app-compare',
  imports: [DecimalPipe],
  templateUrl: './compare.html',
  styleUrl: './compare.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Compare {
  private readonly api = inject(ApiService);
  protected readonly resource = apiResource<CompareResponse>(this.api, () => '/api/claude/compare');

  protected readonly all = computed<Row[]>(() => {
    const projects = this.resource.state().data?.projects ?? [];
    return projects.map((p) => ({
      id: p.path || p.name,
      name: (p.name || '').split('/').filter(Boolean).pop() || p.name || '?',
      sessions: p.sessions || 0,
      cost: p.cost || 0,
      avgCost: p.avgCost || 0,
      cacheHit: p.cacheHit || 0,
      prompts: p.prompts || 0,
    }));
  });

  protected readonly sel = signal<Set<string>>(new Set());
  constructor() {
    // Initialize selection set to "all" once data arrives.
    effect(() => {
      const rows = this.all();
      if (rows.length > 0 && this.sel().size === 0) {
        this.sel.set(new Set(rows.map((r) => r.id)));
      }
    });
  }

  protected readonly rows = computed<Row[]>(() => {
    const s = this.sel();
    return this.all().filter((r) => s.has(r.id));
  });

  protected readonly best = computed<Row | null>(() => {
    const sorted = [...this.rows()].sort(
      (a, b) => (b.cacheHit - b.avgCost / 100) - (a.cacheHit - a.avgCost / 100)
    );
    return sorted[0] ?? null;
  });

  protected toggle(id: string): void {
    this.sel.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  protected cacheColor(v: number): string {
    return v >= 0.7 ? 'var(--success)' : v >= 0.5 ? 'var(--warn)' : 'var(--error)';
  }
  protected fmt$(n: number): string {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

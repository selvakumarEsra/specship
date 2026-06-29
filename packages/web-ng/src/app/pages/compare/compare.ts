/** Compare projects — table + best-callout. */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { PageHead } from '../../ui/page-head';
import { Icon } from '../../shell/icon/icon';
import type { CompareResponse } from '../../api/types';

// Color per model family — keyed by the first fragment that matches the model id.
const MODEL_COLORS: Array<[RegExp, string]> = [
  [/opus/i,   '#A586F5'],
  [/sonnet/i, '#5B93F2'],
  [/haiku/i,  '#29D2BE'],
];
const MODEL_COLOR_OTHER = '#5C6573';

function modelColor(model: string): string {
  for (const [re, color] of MODEL_COLORS) if (re.test(model)) return color;
  return MODEL_COLOR_OTHER;
}

function modelLabel(model: string): string {
  if (/opus/i.test(model))   return 'Opus';
  if (/sonnet/i.test(model)) return 'Sonnet';
  if (/haiku/i.test(model))  return 'Haiku';
  return model.replace(/^claude-/i, '');
}

export interface ModelSegment {
  model: string;
  label: string;
  color: string;
  cost: number;
  widthPct: number;
}

export interface LegendEntry {
  label: string;
  color: string;
}

interface Row {
  id: string;
  name: string;
  sessions: number;
  cost: number;
  avgCost: number;
  cacheHit: number;
  prompts: number;
  drift: number;
  byModel: Array<{ model: string; cost: number }>;
  topTools: string[];
}

@Component({
  selector: 'app-compare',
  imports: [DecimalPipe, PageHead, Icon],
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
      drift: p.drift ?? 0,
      byModel: p.byModel ?? [],
      topTools: p.topTools ?? [],
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

  /** Max total cost across visible rows — used to scale stacked-bar widths. */
  protected readonly maxCost = computed<number>(() => {
    const costs = this.rows().map((r) => r.cost);
    return costs.length ? Math.max(...costs) : 1;
  });

  /** Per-row stacked bar segments, widths scaled to maxCost. */
  protected segments(row: Row): ModelSegment[] {
    const max = this.maxCost();
    return row.byModel.map((m) => ({
      model: m.model,
      label: modelLabel(m.model),
      color: modelColor(m.model),
      cost: m.cost,
      widthPct: max > 0 ? (m.cost / max) * 100 : 0,
    }));
  }

  /** Legend entries from models actually present across visible rows. */
  protected readonly legend = computed<LegendEntry[]>(() => {
    const seen = new Map<string, LegendEntry>();
    for (const row of this.rows()) {
      for (const m of row.byModel) {
        const label = modelLabel(m.model);
        if (!seen.has(label)) {
          seen.set(label, { label, color: modelColor(m.model) });
        }
      }
    }
    return [...seen.values()];
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

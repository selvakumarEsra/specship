import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface SegmentedOption {
  value: string;
  label: string;
}

/**
 * Segmented control — pill-group toggle. Mirrors design ui.jsx Segmented.
 * `size="sm"` matches the design's compact range selector.
 */
@Component({
  selector: 'app-segmented',
  imports: [],
  template: `<div class="seg">
    @for (o of options(); track o.value) {
      <button
        type="button"
        class="seg-opt"
        [class.active]="o.value === value()"
        [class.sm]="size() === 'sm'"
        (click)="change.emit(o.value)"
      >{{ o.label }}</button>
    }
  </div>`,
  styles: [`
    :host { display: inline-flex; }
    .seg {
      display: inline-flex;
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-radius: 7px;
      padding: 2px;
      gap: 2px;
    }
    .seg-opt {
      border: none;
      cursor: pointer;
      border-radius: 5px;
      padding: 5px 12px;
      font-size: var(--fs-sm);
      font-weight: 500;
      font-family: var(--font-ui);
      background: transparent;
      color: var(--text-muted);
      transition: all 100ms;
    }
    .seg-opt.sm { padding: 3px 9px; }
    .seg-opt.active {
      background: var(--bg-elevated);
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Segmented {
  readonly options = input<SegmentedOption[]>([]);
  readonly value = input<string>('');
  readonly size = input<'sm' | 'md'>('md');
  readonly change = output<string>();
}

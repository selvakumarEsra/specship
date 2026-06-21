import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../shell/icon/icon';

/**
 * Page header — icon tile + title + sub + projected actions.
 * Mirrors design ui.jsx PageHead. Project actions into the `[actions]` slot.
 */
@Component({
  selector: 'app-page-head',
  imports: [Icon],
  template: `<div class="page-head row">
    @if (icon()) {
      <div class="ph-icon">
        <app-icon [name]="icon()!" [size]="18" />
      </div>
    }
    <div class="grow ph-text">
      <div class="ph-title">{{ title() }}</div>
      @if (sub()) { <div class="secondary ph-sub">{{ sub() }}</div> }
    </div>
    <div class="row gap-8 ph-actions"><ng-content select="[actions]" /></div>
  </div>`,
  styles: [`
    :host { display: block; }
    .page-head { gap: 12px; margin-bottom: 18px; align-items: flex-start; }
    .ph-icon {
      width: 34px; height: 34px; border-radius: 9px;
      background: var(--bg-panel); border: 1px solid var(--border-subtle);
      display: grid; place-items: center; color: var(--accent); flex-shrink: 0;
    }
    .ph-text { min-width: 0; }
    .ph-title { font-size: var(--fs-title); font-weight: 600; letter-spacing: -0.01em; }
    .ph-sub { margin-top: 2px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHead {
  readonly icon = input<string>('');
  readonly title = input.required<string>();
  readonly sub = input<string>('');
}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../shell/icon/icon';

/**
 * Empty state — centred icon tile + title + body + projected action.
 * Mirrors design ui.jsx Empty. Project a CTA into the `[action]` slot.
 */
@Component({
  selector: 'app-empty',
  imports: [Icon],
  template: `<div class="empty-wrap">
    <div class="empty-inner">
      <div class="empty-icon">
        <app-icon [name]="icon() || 'box'" [size]="24" />
      </div>
      <div class="empty-title">{{ title() }}</div>
      @if (body()) { <div class="secondary empty-body">{{ body() }}</div> }
      <div class="empty-action"><ng-content select="[action]" /></div>
    </div>
  </div>`,
  styles: [`
    :host { display: block; height: 100%; }
    .empty-wrap { display: grid; place-items: center; height: 100%; min-height: 280px; text-align: center; padding: 40px; }
    .empty-inner { max-width: 360px; }
    .empty-icon {
      width: 52px; height: 52px; border-radius: 14px;
      background: var(--bg-panel); border: 1px solid var(--border-subtle);
      display: grid; place-items: center; color: var(--text-muted); margin: 0 auto 16px;
    }
    .empty-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .empty-body { line-height: 1.55; }
    .empty-action:not(:empty) { margin-top: 16px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Empty {
  readonly icon = input<string>('');
  readonly title = input.required<string>();
  readonly body = input<string>('');
}

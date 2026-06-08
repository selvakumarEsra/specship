import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-pick-project-empty',
  imports: [Icon],
  template: `
    <div class="empty-wrap">
      <div class="empty-card">
        <app-icon name="folder" [size]="28" />
        <div class="title">Pick a project</div>
        <div class="sub">
          {{ surface() }} is project-scoped. Choose a project in the picker above
          (top bar, next to the menu) to see its data here.
        </div>
        <div class="hint mono">
          Projects are auto-discovered from <span>~/.claude/projects/</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex: 1; }
    .empty-wrap { flex: 1; display: grid; place-items: center; padding: 40px 20px; }
    .empty-card {
      max-width: 420px; text-align: center;
      padding: 32px 28px;
      background: var(--bg-panel);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
    }
    .empty-card app-icon { color: var(--text-muted); margin-bottom: 12px; }
    .empty-card .title { font-size: 16px; font-weight: 650; letter-spacing: -0.01em; margin-bottom: 6px; }
    .empty-card .sub { color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin-bottom: 14px; }
    .empty-card .hint { color: var(--text-muted); font-size: 11px; }
    .empty-card .hint span { color: var(--node-spec); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PickProjectEmpty {
  /** The page name shown in the message. e.g. "The graph", "Specs". */
  readonly surface = input<string>('This page');
}

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';

const ITEMS: Array<{ id: string; label: string; sub: string }> = [
  { id: 'dashboard', label: 'Dashboard', sub: '/dashboard' },
  { id: 'graph', label: 'Graph', sub: '/graph' },
  { id: 'specs', label: 'Specs', sub: '/specs' },
  { id: 'drift', label: 'Drift queue', sub: '/drift' },
  { id: 'workflows', label: 'Workflows', sub: '/workflows' },
  { id: 'runs', label: 'Runs', sub: '/runs' },
  { id: 'chat', label: 'Chat', sub: '/chat' },
  { id: 'sessions', label: 'Sessions', sub: '/sessions' },
  { id: 'heatmap', label: 'Heatmap', sub: '/heatmap' },
  { id: 'costs', label: 'Costs', sub: '/costs' },
  { id: 'compare', label: 'Compare projects', sub: '/compare' },
  { id: 'tips', label: 'Tips', sub: '/tips' },
  { id: 'settings', label: 'Settings', sub: '/settings' },
];

@Component({
  selector: 'app-command-palette',
  imports: [],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPalette {
  readonly open = input(false);
  readonly close = output<void>();

  private readonly router = inject(Router);
  protected readonly items = ITEMS;

  protected go(id: string): void {
    this.router.navigate(['/' + id]);
    this.close.emit();
  }

  protected onBackdrop(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.close.emit();
  }
}

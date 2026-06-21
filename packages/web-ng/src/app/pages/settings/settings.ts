import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Icon } from '../../shell/icon/icon';
import { PageHead } from '../../ui/page-head';
import { Segmented } from '../../ui/segmented';
import { ApiService } from '../../api/api';
import { ThemeService } from '../../theme/theme';

interface PricingRow { model: string; input: string; output: string; }

@Component({
  selector: 'app-settings',
  imports: [Icon, PageHead, Segmented],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly api = inject(ApiService);
  protected readonly theme = inject(ThemeService);

  protected setTheme(p: 'dark' | 'light' | 'system'): void { this.theme.setPref(p); }

  // Claude Code toggles
  protected readonly ingest = signal(true);
  protected readonly watch = signal(true);
  protected readonly motion = signal(false);

  protected toggleIngest(): void  { this.ingest.update((v) => !v); }
  protected toggleWatch(): void   { this.watch.update((v) => !v); }
  protected toggleMotion(): void  { this.motion.update((v) => !v); }

  protected replayIntro(): void {
    try { sessionStorage.removeItem('specship-booted'); } catch { /* noop */ }
    window.location.reload();
  }

  protected readonly themeOptions = [
    { value: 'dark',   label: 'Dark' },
    { value: 'light',  label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  protected readonly editorOptions = ['code (VS Code)', 'subl (Sublime)', 'cursor', 'nvim'];

  protected readonly pricing: PricingRow[] = [
    { model: 'claude-opus-4',    input: '15.00', output: '75.00' },
    { model: 'claude-sonnet-4',  input: '3.00',  output: '15.00' },
    { model: 'claude-haiku-4',   input: '0.80',  output: '4.00'  },
  ];
}

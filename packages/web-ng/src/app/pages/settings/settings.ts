import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ApiService } from '../../api/api';
import { ThemeService } from '../../theme/theme';

@Component({
  selector: 'app-settings',
  imports: [],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly api = inject(ApiService);
  protected readonly theme = inject(ThemeService);

  protected setTheme(p: 'dark' | 'light' | 'system'): void { this.theme.setPref(p); }
}

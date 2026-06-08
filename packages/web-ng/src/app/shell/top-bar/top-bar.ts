import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ThemeService } from '../../theme/theme';
import { Icon } from '../icon/icon';
import { ProjectPicker } from '../project-picker/project-picker';

@Component({
  selector: 'app-top-bar',
  imports: [Icon, ProjectPicker],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopBar {
  readonly toggleSidebar = output<void>();
  readonly openPalette = output<void>();

  private readonly theme = inject(ThemeService);
  protected readonly effective = this.theme.effective;

  protected onToggleTheme(): void { this.theme.toggle(); }
  protected onMenuClick(): void { this.toggleSidebar.emit(); }
  protected onPalette(): void { this.openPalette.emit(); }
}

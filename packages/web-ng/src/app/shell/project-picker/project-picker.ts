import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal } from '@angular/core';
import { ProjectsService } from '../../api/projects';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-project-picker',
  imports: [Icon],
  templateUrl: './project-picker.html',
  styleUrl: './project-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ProjectPicker {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly projects = inject(ProjectsService);

  protected readonly open = signal(false);
  protected readonly query = signal('');

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.projects.projects();
    if (!q) return list;
    return list.filter((p) =>
      p.path.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
    );
  });

  protected readonly badge = computed<number>(() => this.projects.projects().length);

  protected toggle(): void { this.open.update((v) => !v); }

  protected pick(slug: string): void {
    this.projects.setActive(slug);
    this.open.set(false);
    this.query.set('');
  }

  protected clear(): void {
    this.projects.setActive(null);
    this.open.set(false);
  }

  protected onQuery(v: string): void { this.query.set(v); }

  protected onDocumentClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const target = ev.target as Node | null;
    if (target && !(this.host.nativeElement as HTMLElement).contains(target)) {
      this.open.set(false);
    }
  }

  protected onEscape(): void { if (this.open()) this.open.set(false); }

  protected formatRelative(ms: number): string {
    if (!ms) return '';
    const diff = Date.now() - ms;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(ms).toLocaleDateString();
  }

  protected shortPath(p: string): string {
    if (!p) return '';
    const home = this.detectHome();
    if (home && p === home) return '~';
    if (home && p.startsWith(home + '/')) return '~/' + p.slice(home.length + 1);
    return p;
  }

  /** Heuristic — only used to display "~/foo" instead of "/Users/x/foo". */
  private detectHome(): string | null {
    const claudeRoot = this.projects.claudeRoot();
    if (!claudeRoot) return null;
    const marker = '/.claude/projects';
    if (claudeRoot.endsWith(marker)) return claudeRoot.slice(0, -marker.length);
    return null;
  }
}

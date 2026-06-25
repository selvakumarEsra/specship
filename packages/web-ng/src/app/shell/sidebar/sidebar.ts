import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { ProjectsService } from '../../api/projects';
import type { StatusResponse, TipsResponse, ReflectListResponse } from '../../api/types';
import { Icon } from '../icon/icon';
import { LogoMark } from '../logo-mark/logo-mark';

interface NavItem {
  id: string;
  label: string;
  icon: string;
  badge?: () => number;
  badgeKind?: 'error' | 'warn';
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, Icon, LogoMark],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  readonly collapsed = input(false);

  private readonly api = inject(ApiService);
  private readonly projects = inject(ProjectsService);
  private readonly status = apiResource<StatusResponse>(this.api, () => `/api/status${this.projects.projectQuery()}`);
  private readonly tips = apiResource<TipsResponse>(this.api, () => '/api/claude/tips');
  private readonly improvements = apiResource<ReflectListResponse>(this.api, () => '/api/reflect?state=open');

  protected readonly nav: NavGroup[] = [
    {
      group: 'Project',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        { id: 'graph', label: 'Graph', icon: 'graph' },
        { id: 'specs', label: 'Specs', icon: 'book' },
        { id: 'drift', label: 'Drift queue', icon: 'drift', badge: () => this.status.state().data?.drift ?? 0, badgeKind: 'warn' },
        {
          id: 'improvements',
          label: 'Improvements',
          icon: 'sparkles',
          badge: () => (this.improvements.state().data?.proposals ?? []).filter((p) => p.severity === 'high').length,
          badgeKind: 'error',
        },
        { id: 'workflows', label: 'Workflows', icon: 'workflow' },
        { id: 'runs', label: 'Runs', icon: 'play' },
        { id: 'chat', label: 'Chat', icon: 'chat' },
      ],
    },
    {
      group: 'Claude Code',
      items: [
        { id: 'sessions', label: 'Sessions', icon: 'sessions' },
        { id: 'heatmap', label: 'Heatmap', icon: 'heatmap' },
        { id: 'costs', label: 'Costs', icon: 'dollar' },
        { id: 'specship-impact', label: 'SpecShip Impact', icon: 'graph' },
        { id: 'compare', label: 'Compare projects', icon: 'compare' },
        { id: 'memory', label: 'Memory', icon: 'memory' },
        {
          id: 'tips',
          label: 'Tips',
          icon: 'tips',
          badge: () => (this.tips.state().data?.tips ?? []).filter((t) => t.severity !== 'info').length,
          badgeKind: 'error',
        },
      ],
    },
  ];

  protected badgeOf(item: NavItem): number {
    return item.badge ? item.badge() : 0;
  }
}

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../shell/icon/icon';
import { LogoMark } from '../../shell/logo-mark/logo-mark';

interface Token { name: string; value: string; sample: 'bg' | 'fg' | 'border'; }
interface NodeColor { name: string; varName: string; }
interface StatePill { kind: string; cls: string; }

@Component({
  selector: 'app-design',
  imports: [Icon, LogoMark],
  templateUrl: './design.html',
  styleUrl: './design.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Design {
  protected readonly surfaces: Token[] = [
    { name: '--bg-canvas', value: 'canvas', sample: 'bg' },
    { name: '--bg-canvas-2', value: 'graph void', sample: 'bg' },
    { name: '--bg-panel', value: 'panel', sample: 'bg' },
    { name: '--bg-panel-2', value: 'panel-2', sample: 'bg' },
    { name: '--bg-elevated', value: 'elevated', sample: 'bg' },
  ];

  protected readonly text: Token[] = [
    { name: '--text-primary', value: 'primary', sample: 'fg' },
    { name: '--text-secondary', value: 'secondary', sample: 'fg' },
    { name: '--text-muted', value: 'muted', sample: 'fg' },
    { name: '--text-faint', value: 'faint', sample: 'fg' },
  ];

  protected readonly nodeColors: NodeColor[] = [
    { name: 'code', varName: '--node-code' },
    { name: 'spec', varName: '--node-spec' },
    { name: 'test', varName: '--node-test' },
    { name: 'route', varName: '--node-route' },
  ];

  protected readonly semantic: NodeColor[] = [
    { name: 'success', varName: '--success' },
    { name: 'warn', varName: '--warn' },
    { name: 'error', varName: '--error' },
    { name: 'info', varName: '--info' },
  ];

  protected readonly statePills: StatePill[] = [
    { kind: 'pending', cls: 'pending' },
    { kind: 'running', cls: 'running' },
    { kind: 'paused', cls: 'paused' },
    { kind: 'completed', cls: 'completed' },
    { kind: 'failed', cls: 'failed' },
    { kind: 'cancelled', cls: 'cancelled' },
  ];

  protected readonly specStates: StatePill[] = [
    { kind: 'verified', cls: 'completed' },
    { kind: 'drifted', cls: 'paused' },
    { kind: 'broken', cls: 'failed' },
    { kind: 'orphaned', cls: 'cancelled' },
  ];

  protected readonly fineSizes: number[] = [4, 6, 8, 10, 14];

  protected readonly iconSample: string[] = [
    'dashboard', 'graph', 'book', 'drift', 'workflow', 'play', 'chat', 'sessions',
    'heatmap', 'dollar', 'compare', 'tips', 'memory', 'settings', 'box',
    'search', 'command', 'refresh', 'filter', 'reveal', 'copy', 'recenter',
    'plus', 'minus', 'check', 'x', 'arrowRight', 'sparkles', 'sun', 'moon',
  ];
}

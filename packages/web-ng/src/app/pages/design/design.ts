import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../../shell/icon/icon';
import { PageHead } from '../../ui/page-head';
import { StatePill } from '../../ui/state-pill';
import { Pill } from '../../ui/pill';
import { CopyBtn } from '../../ui/copy-btn';

interface Swatch { name: string; varName: string; hex: string; }
interface NodeSample { label: string; kind: 'code' | 'spec' | 'test' | 'route'; state?: string; }

@Component({
  selector: 'app-design',
  imports: [Icon, PageHead, StatePill, Pill, CopyBtn],
  templateUrl: './design.html',
  styleUrl: './design.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Design {
  protected readonly surfaceSwatches: Swatch[] = [
    { name: 'bg/canvas',     varName: '--bg-canvas',     hex: '#0E1014' },
    { name: 'bg/panel',      varName: '--bg-panel',      hex: '#161A21' },
    { name: 'bg/elevated',   varName: '--bg-elevated',   hex: '#20262F' },
    { name: 'text/primary',  varName: '--text-primary',  hex: '#E8EBF0' },
    { name: 'text/secondary',varName: '--text-secondary',hex: '#9AA3B2' },
    { name: 'accent/primary',varName: '--accent',        hex: '#3B82F6' },
  ];

  protected readonly nodeSwatches: Swatch[] = [
    { name: 'accent/code',  varName: '--node-code',  hex: 'purple' },
    { name: 'accent/spec',  varName: '--node-spec',  hex: 'blue'   },
    { name: 'accent/test',  varName: '--node-test',  hex: 'green'  },
    { name: 'accent/route', varName: '--node-route', hex: 'teal'   },
  ];

  protected readonly nodeColorVars = ['--node-code', '--node-spec', '--node-test', '--node-route'];

  protected readonly specLinkStates = ['verified', 'implemented', 'implementing', 'drifted', 'broken', 'orphaned'];
  protected readonly runStates = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'];
  protected readonly semanticStates = ['success', 'warn', 'error', 'info'];

  protected readonly nodeSamples: NodeSample[] = [
    { label: 'exploreGraph',     kind: 'code' },
    { label: 'REQ-AUTH-005',     kind: 'spec',  state: 'drifted' },
    { label: 'auth.test',        kind: 'test' },
    { label: '/explore',         kind: 'route' },
    { label: 'REQ-GRAPH-009',    kind: 'spec',  state: 'orphaned' },
  ];

  protected readonly iconSample: string[] = [
    'dashboard', 'graph', 'book', 'drift', 'workflow', 'play', 'chat', 'sessions',
    'heatmap', 'dollar', 'compare', 'tips', 'memory', 'settings', 'box',
    'search', 'command', 'refresh', 'filter', 'reveal', 'copy', 'recenter',
    'plus', 'minus', 'check', 'x', 'arrowRight', 'sparkles', 'sun', 'moon',
  ];

  protected nodeColor(kind: string, state?: string): string {
    if (state === 'drifted')  return 'var(--warn)';
    if (state === 'orphaned') return 'var(--error)';
    const MAP: Record<string, string> = {
      code:  'var(--node-code)',
      spec:  'var(--node-spec)',
      test:  'var(--node-test)',
      route: 'var(--node-route)',
    };
    return MAP[kind] ?? 'var(--accent)';
  }

  protected nodeBg(kind: string, state?: string): string {
    const c = this.nodeColor(kind, state);
    return `color-mix(in srgb, ${c} 16%, var(--bg-panel))`;
  }

  protected nodeBorder(kind: string, state?: string): string {
    const c = this.nodeColor(kind, state);
    if (state) return `1.5px solid ${c}`;
    return `1.5px solid color-mix(in srgb, ${c} 45%, transparent)`;
  }
}

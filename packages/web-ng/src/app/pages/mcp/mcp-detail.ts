/**
 * MCP server detail (MCP-PAGE-DOC / REQ-MCP-003, REQ-MCP-004, REQ-MCP-005,
 * REQ-MCP-007).
 *
 * Deep-linkable `mcp/:id` view of one server: a state-adaptive status banner,
 * summary tiles, a tools accordion (input schema + example call + copy), the
 * clients using it, and its raw JSON configuration. Shares the `/api/mcp/servers`
 * resource (+ seed fallback) with the list. An unknown id renders a not-found
 * empty state. Mirrors the design's `screens-mcp.jsx` ServerDetail.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { Pill } from '../../ui/pill';
import { CopyBtn } from '../../ui/copy-btn';
import { Empty } from '../../ui/empty';
import { Icon } from '../../shell/icon/icon';
import { MCP_SEED } from '../../api/mcp-seed';
import {
  MCP_CLIENT_META,
  MCP_SCOPE_META,
  MCP_STATE_META,
  type McpClientMeta,
  type McpScopeMeta,
  type McpStateMeta,
} from './mcp-meta';
import type {
  McpClientState,
  McpServer,
  McpServerScope,
  McpServerState,
  McpServersResponse,
  McpTool,
} from '../../api/types';

@Component({
  selector: 'app-mcp-detail',
  imports: [Pill, CopyBtn, Empty, Icon],
  templateUrl: './mcp-detail.html',
  styleUrl: './mcp-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpDetail {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly resource = apiResource<McpServersResponse>(this.api, () => '/api/mcp/servers');

  private readonly paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  protected readonly serverId = computed(() => this.paramMap().get('id') ?? '');

  protected readonly loading = computed(() => this.resource.state().loading);

  private readonly servers = computed<McpServer[]>(() => {
    const s = this.resource.state();
    if (s.loading) return [];
    const live = s.data?.servers;
    return live && live.length ? live : MCP_SEED.servers;
  });

  protected readonly server = computed<McpServer | undefined>(() =>
    this.servers().find((s) => s.id === this.serverId()),
  );

  /** Distinguishes "still loading" from "loaded but no such server". */
  protected readonly notFound = computed(() => !this.loading() && !this.server());

  // ── tools accordion (single-open) ─────────────────────────────────────────
  private readonly openTool = signal<string | null>(null);
  protected isToolOpen(name: string): boolean {
    return this.openTool() === name;
  }
  protected toggleTool(name: string): void {
    this.openTool.update((o) => (o === name ? null : name));
  }

  // ── summary tiles ─────────────────────────────────────────────────────────
  protected readonly totalCalls = computed(() => (this.server()?.tools ?? []).reduce((a, t) => a + t.stat.calls, 0));
  protected readonly totalTokens = computed(() => (this.server()?.tools ?? []).reduce((a, t) => a + t.stat.tokens, 0));

  // ── presentation helpers ──────────────────────────────────────────────────
  protected stateMeta(state: McpServerState): McpStateMeta {
    return MCP_STATE_META[state];
  }
  protected scopeMeta(scope: McpServerScope): McpScopeMeta {
    return MCP_SCOPE_META[scope];
  }
  protected clientMeta(state: McpClientState): McpClientMeta {
    return MCP_CLIENT_META[state];
  }
  protected mix(color: string, pct = 14): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }
  protected avg(t: McpTool): number {
    return t.stat.calls ? Math.round(t.stat.tokens / t.stat.calls) : 0;
  }
  protected isHeavy(t: McpTool): boolean {
    return this.avg(t) > 8000;
  }
  protected isCold(t: McpTool): boolean {
    return t.stat.calls === 0;
  }

  protected back(): void {
    this.router.navigate(['/mcp']);
  }
  protected go(route: string): void {
    this.router.navigate(['/' + route]);
  }

  protected fmtK(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }
  protected fmtTok(n: number): string {
    return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : this.fmtK(n);
  }
}

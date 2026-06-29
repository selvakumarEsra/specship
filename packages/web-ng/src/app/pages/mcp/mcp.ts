/**
 * MCP servers — list view (MCP-PAGE-DOC / REQ-MCP-001, REQ-MCP-002, REQ-MCP-006).
 *
 * Lists every configured Model Context Protocol server grouped by scope
 * (global / project), with summary stat tiles and per-server status. Data comes
 * from `/api/mcp/servers` via `apiResource`, falling back to `MCP_SEED` when the
 * endpoint is unavailable or empty (flagged `isSeed`). Mirrors the design's
 * `screens-mcp.jsx` ServerList. Selecting a server routes to `mcp/:id`.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../api/api';
import { apiResource } from '../../api/resource';
import { PageHead } from '../../ui/page-head';
import { Pill } from '../../ui/pill';
import { Icon } from '../../shell/icon/icon';
import { MCP_SEED } from '../../api/mcp-seed';
import {
  MCP_SCOPE_META,
  MCP_STATE_META,
  type McpScopeMeta,
  type McpStateMeta,
} from './mcp-meta';
import type { McpServer, McpServerScope, McpServersResponse } from '../../api/types';

interface ScopeGroup {
  key: McpServerScope;
  meta: McpScopeMeta;
  servers: McpServer[];
}

@Component({
  selector: 'app-mcp',
  imports: [RouterLink, PageHead, Pill, Icon],
  templateUrl: './mcp.html',
  styleUrl: './mcp.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mcp {
  private readonly api = inject(ApiService);
  private readonly resource = apiResource<McpServersResponse>(this.api, () => '/api/mcp/servers');

  /** True while the first fetch is in flight. */
  protected readonly loading = computed(() => this.resource.state().loading);

  /** Live servers when present, else the seed dataset (REQ-MCP-006.A3). */
  protected readonly servers = computed<McpServer[]>(() => {
    const s = this.resource.state();
    if (s.loading) return [];
    const live = s.data?.servers;
    return live && live.length ? live : MCP_SEED.servers;
  });

  /** True when the rendered list is the seed fallback, not live data. */
  protected readonly isSeed = computed(() => {
    const s = this.resource.state();
    return !s.loading && !(s.data?.servers?.length);
  });

  /** True when the fetch errored (and there was nothing to fall back to live). */
  protected readonly errored = computed(() => this.resource.state().error !== null);

  // ── summary tiles ─────────────────────────────────────────────────────────
  protected readonly total = computed(() => this.servers().length);
  protected readonly running = computed(() => this.servers().filter((s) => s.state === 'running').length);
  protected readonly totalTools = computed(() => this.servers().reduce((a, s) => a + s.tools.length, 0));
  protected readonly needsAttention = computed(() => this.servers().filter((s) => s.state === 'error').length);

  // ── scope groups (omit empty) ─────────────────────────────────────────────
  protected readonly groups = computed<ScopeGroup[]>(() => {
    const servers = this.servers();
    return (['global', 'project'] as McpServerScope[])
      .map((key) => ({ key, meta: MCP_SCOPE_META[key], servers: servers.filter((s) => s.scope === key) }))
      .filter((g) => g.servers.length > 0);
  });

  protected scopeMeta(scope: McpServerScope): McpScopeMeta {
    return MCP_SCOPE_META[scope];
  }

  protected stateMeta(state: McpServer['state']): McpStateMeta {
    return MCP_STATE_META[state];
  }

  protected mix(color: string, pct = 14): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }

  protected toolLabel(n: number): string {
    return n === 1 ? 'tool' : 'tools';
  }

  protected onReload(): void {
    this.resource.refetch();
  }
}

/**
 * Shared presentation metadata for the MCP pages (list + detail).
 * Mirrors the SRV_STATE / SCOPE / CLIENT_STATE maps in the design's
 * `screens-mcp.jsx`. Colours are CSS tokens resolved at render time.
 */
import type { McpClientState, McpServerScope, McpServerState } from '../../api/types';

export interface McpStateMeta {
  color: string;
  label: string;
  /** Whether the state pill renders a leading status dot. */
  dot: boolean;
}

export interface McpScopeMeta {
  color: string;
  label: string;
  /** The config file this scope maps to. */
  hint: string;
  icon: string;
}

export interface McpClientMeta {
  color: string;
  label: string;
}

export const MCP_STATE_META: Record<McpServerState, McpStateMeta> = {
  running: { color: 'var(--success)', label: 'Running', dot: true },
  error: { color: 'var(--error)', label: 'Failed', dot: true },
  disabled: { color: 'var(--text-muted)', label: 'Disabled', dot: false },
};

export const MCP_SCOPE_META: Record<McpServerScope, McpScopeMeta> = {
  global: { color: 'var(--node-route)', label: 'Global', hint: '~/.claude.json', icon: 'database' },
  project: { color: 'var(--accent)', label: 'Project', hint: '.mcp.json', icon: 'folder' },
};

export const MCP_CLIENT_META: Record<McpClientState, McpClientMeta> = {
  active: { color: 'var(--success)', label: 'Active' },
  connected: { color: 'var(--node-spec)', label: 'Connected' },
  idle: { color: 'var(--text-muted)', label: 'Idle' },
};

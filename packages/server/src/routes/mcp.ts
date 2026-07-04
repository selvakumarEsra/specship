/**
 * MCP servers route — LIVE data (REQ-DASHLEAN-006).
 *
 * Two real sources, merged:
 *   1. Claude Code's own config — `~/.claude.json` (global `mcpServers` +
 *      `projects[<primary>].mcpServers`) and `<primary>/.mcp.json`. This is
 *      the actual installed-server inventory, the same files `specship
 *      install` writes.
 *   2. The transcript analytics DB — `claude_tool_calls` rows whose
 *      `tool_name` is `mcp__<server>__<tool>` give real per-server/per-tool
 *      call counts, result sizes, and last-used timestamps.
 *
 * A server is `running` when it has tool calls in the last 24 h, `idle` when
 * configured but quiet, — states are usage-derived, never invented.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';

type DbHandle = { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } };

function getDb(cg: SpecShipInstance): DbHandle {
  const anyCg = cg as unknown as { db?: { getDb?: () => unknown }; queries?: { db?: unknown } };
  if (anyCg.db?.getDb) return anyCg.db.getDb() as DbHandle;
  return anyCg.queries?.db as DbHandle;
}

interface McpConfigEntry { command?: string; args?: string[]; url?: string; type?: string }

function readJson(p: string): Record<string, any> | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Collect configured servers from Claude Code's config surfaces. */
function configuredServers(projectRoot: string | null): Map<string, { scope: string; entry: McpConfigEntry }> {
  const out = new Map<string, { scope: string; entry: McpConfigEntry }>();
  const claudeJson = readJson(path.join(os.homedir(), '.claude.json'));
  for (const [name, entry] of Object.entries((claudeJson?.['mcpServers'] ?? {}) as Record<string, McpConfigEntry>)) {
    out.set(name, { scope: 'user', entry });
  }
  if (projectRoot) {
    const proj = claudeJson?.['projects']?.[projectRoot];
    for (const [name, entry] of Object.entries((proj?.['mcpServers'] ?? {}) as Record<string, McpConfigEntry>)) {
      out.set(name, { scope: 'project', entry });
    }
    const mcpJson = readJson(path.join(projectRoot, '.mcp.json'));
    for (const [name, entry] of Object.entries((mcpJson?.['mcpServers'] ?? {}) as Record<string, McpConfigEntry>)) {
      out.set(name, { scope: 'project', entry });
    }
  }
  return out;
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  function requirePrimary(reply: FastifyReply): SpecShipInstance | null {
    if (!app.primaryCg) {
      reply.code(409).send({ error: 'analytics unavailable: no primary project configured', code: 'no_primary' });
      return null;
    }
    return app.primaryCg;
  }

  app.get('/api/mcp/servers', async (_req, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const projectRoot = (app as unknown as { primaryProjectPath?: string }).primaryProjectPath
      ?? (cg as unknown as { projectRoot?: string }).projectRoot ?? null;

    // Real usage from transcripts: mcp__<server>__<tool>
    let usage: Array<{ tool_name: string; calls: number; bytes: number; last: number | string | null }> = [];
    try {
      const db = getDb(cg);
      usage = db.prepare(`
        SELECT tool_name, COUNT(*) as calls,
               COALESCE(SUM(result_length), 0) as bytes,
               MAX(ts) as last
        FROM claude_tool_calls
        WHERE tool_name LIKE 'mcp__%'
        GROUP BY tool_name
      `).all() as typeof usage;
    } catch { /* analytics tables absent — config-only response */ }

    const byServer = new Map<string, { calls: number; bytes: number; last: number; tools: Map<string, { calls: number; bytes: number }> }>();
    for (const u of usage) {
      const m = u.tool_name.match(/^mcp__(.+?)__(.+)$/);
      if (!m) continue;
      const [, server, tool] = m;
      const key = server as string;
      if (!byServer.has(key)) byServer.set(key, { calls: 0, bytes: 0, last: 0, tools: new Map() });
      const s = byServer.get(key)!;
      s.calls += u.calls; s.bytes += u.bytes;
      // `ts` is epoch milliseconds (integer) in the ingest schema.
      const t = typeof u.last === 'number' ? u.last : u.last ? Date.parse(u.last) : 0;
      if (Number.isFinite(t) && t > s.last) s.last = t;
      const tt = s.tools.get(tool as string) ?? { calls: 0, bytes: 0 };
      tt.calls += u.calls; tt.bytes += u.bytes;
      s.tools.set(tool as string, tt);
    }

    const config = configuredServers(projectRoot);
    const names = new Set<string>([...config.keys(), ...byServer.keys()]);
    const now = Date.now();
    const servers = [...names].map((name) => {
      const cfg = config.get(name);
      const use = byServer.get(name);
      const entry = cfg?.entry ?? {};
      const transport = entry.url ? 'http' : 'stdio';
      const command = entry.url ?? [entry.command, ...(entry.args ?? [])].filter(Boolean).join(' ');
      const state = use && now - use.last < 24 * 3600_000 ? 'running' : cfg ? 'idle' : 'stale';
      return {
        id: name, name,
        scope: cfg?.scope ?? 'unknown',
        state, transport, command,
        calls: use?.calls ?? 0,
        resultBytes: use?.bytes ?? 0,
        lastUsed: use?.last ? new Date(use.last).toISOString() : null,
        tools: use ? [...use.tools.entries()]
          .map(([tool, t]) => ({ name: tool, calls: t.calls, resultBytes: t.bytes }))
          .sort((a, b) => b.calls - a.calls) : [],
      };
    }).sort((a, b) => b.calls - a.calls);

    reply.send({ servers });
  });
}

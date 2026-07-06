/**
 * MCP servers routes — inventory, live status, and control (REQ-DESKTOP-026).
 *
 * Three real sources, merged (this fork is Claude Code only, so Claude
 * Code's config surfaces ARE the inventory — no other clients are read):
 *   1. Claude Code's own config — `~/.claude.json` (global `mcpServers` +
 *      `projects[<root>].mcpServers`) and `<projectRoot>/.mcp.json`, the
 *      same files `specship install` writes. Disabled servers come from
 *      `disabledMcpjsonServers` (Claude Code's native mechanism for
 *      `.mcp.json` entries) and `mcpServersDisabled` (our parking map for
 *      `~/.claude.json`-owned entries).
 *   2. The transcript analytics DB — `claude_tool_calls` rows whose
 *      `tool_name` is `mcp__<server>__<tool>` give real per-server/per-tool
 *      call counts, result sizes, last-used timestamps, and the example
 *      call (`input_json`, schema v7).
 *   3. A liveness probe — stdio entries are spawned and asked to answer an
 *      MCP `initialize`; `url` entries get a fetch. Results cache ~30 s.
 *
 * States use the spec vocabulary (deriveState): `disabled` (parked in
 * config) → `failed` (probe refused) → `active` (calls in the last 24 h) →
 * `connected` (probe answered) → `idle`.
 *
 * Writes (PATCH enable/disable, POST add) touch the user's LIVE Claude Code
 * configs, so every write is atomic (write-temp + rename) and preserves
 * unrelated keys byte-for-byte: key order is kept, and the file's existing
 * indentation unit + trailing newline are detected and reused. A file that
 * fails to parse is never overwritten — the edit errors instead.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpecShipInstance } from '../project-registry.js';

type DbHandle = { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } };

function getDb(cg: SpecShipInstance): DbHandle {
  const anyCg = cg as unknown as { db?: { getDb?: () => unknown }; queries?: { db?: unknown } };
  if (anyCg.db?.getDb) return anyCg.db.getDb() as DbHandle;
  return anyCg.queries?.db as DbHandle;
}

export interface McpConfigEntry {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

/** The two files the inventory reads; projectRoot null = user scope only. */
export interface McpConfigPaths {
  claudeJsonPath: string;
  projectRoot: string | null;
}

/** Which config structure owns an entry — decides how enable/disable edits. */
export type McpConfigContainer = 'user' | 'project-local' | 'mcpjson';

export interface ConfiguredServer {
  name: string;
  scope: 'user' | 'project';
  entry: McpConfigEntry;
  /** Absolute path of the file the entry lives in. */
  configFile: string;
  disabled: boolean;
  container: McpConfigContainer;
}

export type McpProbeResult = 'ok' | 'failed';
export type McpServerState = 'disabled' | 'failed' | 'active' | 'connected' | 'idle';

/** Config-write failures the routes translate to HTTP statuses. */
export class McpConfigError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

function readJson(p: string): Record<string, any> | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Collect configured servers from Claude Code's three config surfaces.
 * Precedence on name collision follows Claude Code's own resolution:
 * user (`~/.claude.json` global) < project-local (`projects[<root>]` entry)
 * < `.mcp.json` — later wins, matching what the agent actually loads.
 */
export function configuredServers(paths: McpConfigPaths): Map<string, ConfiguredServer> {
  const out = new Map<string, ConfiguredServer>();
  const claudeJson = readJson(paths.claudeJsonPath);
  const add = (name: string, cfg: Omit<ConfiguredServer, 'name'>) => out.set(name, { name, ...cfg });

  for (const [name, entry] of Object.entries((claudeJson?.['mcpServers'] ?? {}) as Record<string, McpConfigEntry>)) {
    add(name, { scope: 'user', entry, configFile: paths.claudeJsonPath, disabled: false, container: 'user' });
  }
  for (const [name, entry] of Object.entries((claudeJson?.['mcpServersDisabled'] ?? {}) as Record<string, McpConfigEntry>)) {
    add(name, { scope: 'user', entry, configFile: paths.claudeJsonPath, disabled: true, container: 'user' });
  }
  if (paths.projectRoot) {
    const proj = claudeJson?.['projects']?.[paths.projectRoot];
    for (const [name, entry] of Object.entries((proj?.['mcpServers'] ?? {}) as Record<string, McpConfigEntry>)) {
      add(name, { scope: 'project', entry, configFile: paths.claudeJsonPath, disabled: false, container: 'project-local' });
    }
    for (const [name, entry] of Object.entries((proj?.['mcpServersDisabled'] ?? {}) as Record<string, McpConfigEntry>)) {
      add(name, { scope: 'project', entry, configFile: paths.claudeJsonPath, disabled: true, container: 'project-local' });
    }
    const disabledMcpjson = new Set<string>((proj?.['disabledMcpjsonServers'] ?? []) as string[]);
    const mcpJsonPath = path.join(paths.projectRoot, '.mcp.json');
    const mcpJson = readJson(mcpJsonPath);
    for (const [name, entry] of Object.entries((mcpJson?.['mcpServers'] ?? {}) as Record<string, McpConfigEntry>)) {
      add(name, { scope: 'project', entry, configFile: mcpJsonPath, disabled: disabledMcpjson.has(name), container: 'mcpjson' });
    }
  }
  return out;
}

/**
 * Spec vocabulary, in precedence order: a parked entry is `disabled` no
 * matter what; a refused probe is `failed` even with recent calls (the
 * config broke since); recent usage is `active`; a probe answer without
 * recent usage is `connected`; otherwise `idle`.
 */
export function deriveState(
  cfg: { disabled: boolean } | null | undefined,
  usage: { lastMs: number } | null | undefined,
  probe: McpProbeResult | null | undefined,
  nowMs = Date.now(),
): McpServerState {
  if (cfg?.disabled) return 'disabled';
  if (probe === 'failed') return 'failed';
  if (usage && nowMs - usage.lastMs < 24 * 3600_000) return 'active';
  if (probe === 'ok') return 'connected';
  return 'idle';
}

const PROBE_CACHE_MS = 30_000;
const probeCache = new Map<string, { at: number; result: McpProbeResult }>();

/** The MCP initialize request the stdio probe sends (newline-delimited JSON-RPC). */
const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'specship-desktop', version: '0.0.0' },
  },
}) + '\n';

function probeStdio(entry: McpConfigEntry, timeoutMs: number): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let child: import('node:child_process').ChildProcess;
    const done = (result: McpProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill(); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(() => done('failed'), timeoutMs);
    try {
      child = spawn(entry.command!, entry.args ?? [], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(entry.env ?? {}) },
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch {
      done('failed');
      return;
    }
    child.on('error', () => done('failed'));
    child.on('exit', () => done('failed'));
    let buf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        try {
          const msg = JSON.parse(line);
          if (msg && msg.id === 1 && msg.result) { done('ok'); return; }
        } catch { /* partial line */ }
      }
    });
    try { child.stdin?.write(INITIALIZE_REQUEST); } catch { done('failed'); }
  });
}

async function probeUrl(url: string, timeoutMs: number): Promise<McpProbeResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    // Any 4xx/5xx (expired OAuth = 401, dead route = 404) is the failed
    // treatment — the design's sentry example shows 401 as Failed.
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Liveness probe. Never throws and never hangs past `timeoutMs`; a timeout
 * counts as `failed` (the agent couldn't have used it either). Results are
 * cached ~30 s per config shape so a page refresh doesn't respawn servers.
 */
export async function probeServer(entry: McpConfigEntry, timeoutMs = 2500): Promise<McpProbeResult> {
  const key = entry.url ?? [entry.command, ...(entry.args ?? [])].join(' ');
  if (!key) return 'failed';
  const cached = probeCache.get(key);
  if (cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.result;
  const result = entry.url
    ? await probeUrl(entry.url, timeoutMs)
    : entry.command
      ? await probeStdio(entry, timeoutMs)
      : 'failed';
  probeCache.set(key, { at: Date.now(), result });
  return result;
}

// ---- Config writes ----------------------------------------------------------

/** Write-temp + rename so a crash mid-write can't corrupt a live config. */
function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** First indented line's leading whitespace = the file's indent unit. */
function detectJsonStyle(text: string): { indent: string; trailingNewline: boolean } {
  const m = text.match(/\n([ \t]+)\S/);
  return {
    indent: m?.[1] ?? '  ',
    trailingNewline: text.length === 0 || text.endsWith('\n'),
  };
}

/**
 * Parse → mutate → re-serialize preserving key order, the detected indent
 * unit, and the trailing newline — so untouched keys keep their bytes. An
 * unparseable file throws (500) instead of being clobbered.
 */
function editJsonFile(filePath: string, mutate: (data: Record<string, any>) => void): void {
  let text = '';
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { /* missing → create */ }
  let data: Record<string, any> = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new McpConfigError(`refusing to edit unparseable ${filePath}: ${msg}`, 500);
    }
  }
  mutate(data);
  const { indent, trailingNewline } = detectJsonStyle(text);
  atomicWriteFileSync(filePath, JSON.stringify(data, null, indent) + (trailingNewline ? '\n' : ''));
}

/**
 * Move `data[from][name]` → `data[to][name]`. An emptied `mcpServersDisabled`
 * (our parking map) is removed; an emptied `mcpServers` is kept in place —
 * deleting it would re-create it at the END of the object on re-enable,
 * breaking the byte-for-byte round-trip.
 */
function moveEntry(data: Record<string, any>, from: string, to: string, name: string): void {
  const entry = data[from]?.[name];
  if (entry === undefined) throw new McpConfigError(`server "${name}" not found under ${from}`, 404);
  delete data[from][name];
  if (from === 'mcpServersDisabled' && Object.keys(data[from]).length === 0) delete data[from];
  data[to] = { ...(data[to] ?? {}), [name]: entry };
}

/**
 * Enable/disable a configured server by editing its owning file.
 *   - `.mcp.json`-owned → toggle the name in `disabledMcpjsonServers` under
 *     the project's entry in `~/.claude.json` (Claude Code's own mechanism —
 *     `.mcp.json` itself is team-shared and never touched).
 *   - `~/.claude.json`-owned (user or project-local) → move the entry
 *     between `mcpServers` and the `mcpServersDisabled` parking map.
 * Idempotent: a no-op toggle returns without writing. Throws McpConfigError
 * 404 when the name isn't configured anywhere.
 */
export function setServerEnabled(paths: McpConfigPaths, name: string, enabled: boolean): ConfiguredServer {
  const cfg = configuredServers(paths).get(name);
  if (!cfg) throw new McpConfigError(`unknown MCP server "${name}"`, 404);
  if (cfg.disabled === !enabled) return cfg;

  if (cfg.container === 'mcpjson') {
    editJsonFile(paths.claudeJsonPath, (data) => {
      const projects = (data['projects'] = data['projects'] ?? {});
      const proj = (projects[paths.projectRoot!] = projects[paths.projectRoot!] ?? {});
      const list: string[] = proj['disabledMcpjsonServers'] ?? [];
      const next = enabled ? list.filter((n) => n !== name) : [...list, name];
      if (next.length) proj['disabledMcpjsonServers'] = next;
      else delete proj['disabledMcpjsonServers'];
    });
  } else if (cfg.container === 'user') {
    editJsonFile(paths.claudeJsonPath, (data) => {
      if (enabled) moveEntry(data, 'mcpServersDisabled', 'mcpServers', name);
      else moveEntry(data, 'mcpServers', 'mcpServersDisabled', name);
    });
  } else {
    editJsonFile(paths.claudeJsonPath, (data) => {
      const proj = data['projects']?.[paths.projectRoot!];
      if (!proj) throw new McpConfigError(`project entry for ${paths.projectRoot} missing`, 404);
      if (enabled) moveEntry(proj, 'mcpServersDisabled', 'mcpServers', name);
      else moveEntry(proj, 'mcpServers', 'mcpServersDisabled', name);
    });
  }
  return { ...cfg, disabled: !enabled };
}

export interface AddServerInput {
  name: string;
  scope: 'user' | 'project';
  command?: string;
  args?: string[];
  url?: string;
}

/**
 * Add a server: user scope → `~/.claude.json` `mcpServers`; project scope →
 * `<projectRoot>/.mcp.json`. 409 when the name exists on any surface, 400
 * on invalid input. Entry shape matches the installer's (`type` explicit).
 */
export function addServer(paths: McpConfigPaths, input: AddServerInput): ConfiguredServer {
  const name = (input.name ?? '').trim();
  if (!name || /\s/.test(name)) throw new McpConfigError('server name must be a non-empty token', 400);
  if (input.scope !== 'user' && input.scope !== 'project') throw new McpConfigError('scope must be "user" or "project"', 400);
  if (!input.url && !(input.command ?? '').trim()) throw new McpConfigError('either a command or a url is required', 400);
  if (configuredServers(paths).has(name)) throw new McpConfigError(`MCP server "${name}" is already configured`, 409);

  const entry: McpConfigEntry = input.url
    ? { type: 'http', url: input.url }
    : { type: 'stdio', command: input.command!.trim(), ...(input.args?.length ? { args: input.args } : {}) };

  if (input.scope === 'project') {
    if (!paths.projectRoot) throw new McpConfigError('no project open — cannot write .mcp.json', 400);
    const mcpJsonPath = path.join(paths.projectRoot, '.mcp.json');
    editJsonFile(mcpJsonPath, (data) => {
      data['mcpServers'] = { ...(data['mcpServers'] ?? {}), [name]: entry };
    });
    return { name, scope: 'project', entry, configFile: mcpJsonPath, disabled: false, container: 'mcpjson' };
  }
  editJsonFile(paths.claudeJsonPath, (data) => {
    data['mcpServers'] = { ...(data['mcpServers'] ?? {}), [name]: entry };
  });
  return { name, scope: 'user', entry, configFile: paths.claudeJsonPath, disabled: false, container: 'user' };
}

// ---- Routes -----------------------------------------------------------------

interface ServerUsage {
  calls: number;
  bytes: number;
  last: number;
  tools: Map<string, { calls: number; bytes: number }>;
  example: { tool: string; args: Record<string, unknown> } | null;
}

/** Aggregate claude_tool_calls into per-server usage + the latest example call. */
function collectUsage(cg: SpecShipInstance): Map<string, ServerUsage> {
  const byServer = new Map<string, ServerUsage>();
  let usage: Array<{ tool_name: string; calls: number; bytes: number; last: number | string | null }> = [];
  let examples: Array<{ tool_name: string; input_json: string }> = [];
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
    // Latest verbatim inputs (schema v7) — first row per server wins below.
    examples = db.prepare(`
      SELECT tool_name, input_json
      FROM claude_tool_calls
      WHERE tool_name LIKE 'mcp__%' AND input_json IS NOT NULL
      ORDER BY ts DESC
      LIMIT 500
    `).all() as typeof examples;
  } catch { /* analytics tables absent — config-only response */ }

  const parse = (t: string) => t.match(/^mcp__(.+?)__(.+)$/);
  for (const u of usage) {
    const m = parse(u.tool_name);
    if (!m) continue;
    const [, server, tool] = m as unknown as [string, string, string];
    if (!byServer.has(server)) byServer.set(server, { calls: 0, bytes: 0, last: 0, tools: new Map(), example: null });
    const s = byServer.get(server)!;
    s.calls += u.calls; s.bytes += u.bytes;
    // `ts` is epoch milliseconds (integer) in the ingest schema.
    const t = typeof u.last === 'number' ? u.last : u.last ? Date.parse(u.last) : 0;
    if (Number.isFinite(t) && t > s.last) s.last = t;
    const tt = s.tools.get(tool) ?? { calls: 0, bytes: 0 };
    tt.calls += u.calls; tt.bytes += u.bytes;
    s.tools.set(tool, tt);
  }
  for (const row of examples) {
    const m = parse(row.tool_name);
    if (!m) continue;
    const [, server, tool] = m as unknown as [string, string, string];
    const s = byServer.get(server);
    if (!s || s.example) continue;
    try { s.example = { tool, args: JSON.parse(row.input_json) as Record<string, unknown> }; } catch { /* skip bad row */ }
  }
  // Fallback example: the server's top tool with empty args.
  for (const s of byServer.values()) {
    if (s.example) continue;
    const top = [...s.tools.entries()].sort((a, b) => b[1].calls - a[1].calls)[0];
    if (top) s.example = { tool: top[0], args: {} };
  }
  return byServer;
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const paths = (): McpConfigPaths => ({
    claudeJsonPath: path.join(os.homedir(), '.claude.json'),
    projectRoot: app.primaryCg?.getProjectRoot?.() ?? null,
  });

  function requirePrimary(reply: FastifyReply): SpecShipInstance | null {
    if (!app.primaryCg) {
      reply.code(409).send({ error: 'analytics unavailable: no primary project configured', code: 'no_primary' });
      return null;
    }
    return app.primaryCg;
  }

  app.get('/api/mcp/servers', async (_req, reply) => {
    const cg = requirePrimary(reply); if (!cg) return;
    const p = paths();
    const config = configuredServers(p);
    const byServer = collectUsage(cg);

    // Probe every enabled configured server concurrently; disabled and
    // usage-only entries have nothing to probe.
    const probeTargets = [...config.values()].filter((c) => !c.disabled);
    const probes = new Map<string, McpProbeResult>(
      await Promise.all(probeTargets.map(async (c) =>
        [c.name, await probeServer(c.entry)] as [string, McpProbeResult])),
    );

    const names = new Set<string>([...config.keys(), ...byServer.keys()]);
    const servers = [...names].map((name) => {
      const cfg = config.get(name);
      const use = byServer.get(name);
      const entry = cfg?.entry ?? {};
      const transport = entry.url ? 'http' : 'stdio';
      const command = entry.url ?? [entry.command, ...(entry.args ?? [])].filter(Boolean).join(' ');
      const state = deriveState(cfg, use?.last ? { lastMs: use.last } : null, probes.get(name) ?? null);
      return {
        id: name, name,
        scope: cfg?.scope ?? 'unknown',
        state, transport, command,
        configFile: cfg?.configFile ?? null,
        disabled: cfg?.disabled ?? false,
        entry: cfg?.entry ?? null,
        calls: use?.calls ?? 0,
        resultBytes: use?.bytes ?? 0,
        lastUsed: use?.last ? new Date(use.last).toISOString() : null,
        tools: use ? [...use.tools.entries()]
          .map(([tool, t]) => ({ name: tool, calls: t.calls, resultBytes: t.bytes }))
          .sort((a, b) => b.calls - a.calls) : [],
        exampleCall: use?.example ?? null,
      };
    }).sort((a, b) => b.calls - a.calls);

    reply.send({ servers });
  });

  app.patch('/api/mcp/servers/:name', async (
    req: FastifyRequest<{ Params: { name: string }; Body: { enabled?: unknown } }>,
    reply,
  ) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'body must be { enabled: boolean }' });
    }
    const p = paths();
    try {
      const server = setServerEnabled(p, req.params.name, enabled);
      return reply.send({ ok: true, name: server.name, disabled: server.disabled });
    } catch (err) {
      if (err instanceof McpConfigError) {
        // Usage-only servers show up in transcripts but have no config to
        // edit — that's a 400 (bad target), not a 404 (unknown name).
        if (err.statusCode === 404 && app.primaryCg && hasUsage(app.primaryCg, req.params.name)) {
          return reply.code(400).send({ error: `"${req.params.name}" appears in transcripts but has no config entry to toggle` });
        }
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post('/api/mcp/servers', async (
    req: FastifyRequest<{ Body: AddServerInput }>,
    reply,
  ) => {
    try {
      const server = addServer(paths(), req.body ?? ({} as AddServerInput));
      return reply.code(201).send({ ok: true, name: server.name, scope: server.scope, configFile: server.configFile });
    } catch (err) {
      if (err instanceof McpConfigError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}

/** True when transcripts contain any mcp__<name>__* call. */
function hasUsage(cg: SpecShipInstance, name: string): boolean {
  try {
    const db = getDb(cg);
    const rows = db.prepare(
      `SELECT 1 FROM claude_tool_calls WHERE tool_name LIKE 'mcp__' || ? || '__%' LIMIT 1`,
    ).all(name);
    return rows.length > 0;
  } catch {
    return false;
  }
}

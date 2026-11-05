/**
 * GET /api/memory — every installed agent's memory-file hierarchy + notes.
 *
 * Walks each agent's standard memory locations (from `host-profiles.ts`,
 * REQ-AGENTSWITCH-001 — Claude Code's CLAUDE.md tree, Gemini CLI's GEMINI.md
 * tree; each file is tagged with its `host`) and returns a flattened
 * list of MemoryFile records the desktop UI can render directly. Resolves
 * `@path` imports from each instruction file.
 *
 * Levels:
 *   - enterprise — `/Library/Application Support/ClaudeCode/CLAUDE.md` (read-only)
 *   - user       — `~/.claude/CLAUDE.md`
 *   - project    — `<projectRoot>/CLAUDE.md`
 *   - subdir     — `<projectRoot>/<sub>/CLAUDE.md` (one level deep; common case)
 *   - import     — files referenced as `@path` from a project/subdir CLAUDE.md
 *   - note       — `~/.claude/memory/*.md` (agent-written via memory tool)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { decodeProjectSlug } from '../ingest/ingestor.js';
import { HOST_PROFILES, type HostId, type ServerHostProfile } from '../host-profiles.js';

export type MemoryLevel = 'enterprise' | 'user' | 'project' | 'subdir' | 'import' | 'note';
export type MemoryType = 'instruction' | 'note' | 'import';

export interface MemoryFile {
  id: string;
  level: MemoryLevel;
  type: MemoryType;
  name: string;
  scope: string;
  path: string;
  tokens: number;
  lines: number;
  modified: string;
  body: string;
  readOnly?: boolean;
  imports?: string[];
  session?: string;
  tags?: string[];
  /** The agent that reads this file (REQ-AGENTSWITCH-001). */
  host: HostId;
}

export interface MemoryResponse {
  totalTokens: number;
  instructionCount: number;
  noteCount: number;
  importCount: number;
  files: MemoryFile[];
}

function estimateTokens(body: string): number {
  // Rough heuristic: ~4 chars per token. Cheap; the UI tolerates approximation.
  return Math.max(1, Math.round(body.length / 4));
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(ms);
  return d.toLocaleDateString();
}

async function tryRead(filePath: string): Promise<{ body: string; modified: number } | null> {
  try {
    const [body, stat] = await Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]);
    return { body, modified: stat.mtimeMs };
  } catch {
    return null;
  }
}

function extractImports(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^@(\S+)/);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function pathForUi(absolute: string): string {
  const home = os.homedir();
  if (absolute.startsWith(home + path.sep)) return '~/' + absolute.slice(home.length + 1);
  return absolute;
}

function makeFile(opts: {
  id: string;
  level: MemoryLevel;
  type: MemoryType;
  name: string;
  scope: string;
  absolutePath: string;
  body: string;
  modifiedMs: number;
  readOnly?: boolean;
  imports?: string[];
  host: HostId;
}): MemoryFile {
  return {
    id: opts.id,
    level: opts.level,
    type: opts.type,
    name: opts.name,
    scope: opts.scope,
    path: pathForUi(opts.absolutePath),
    tokens: estimateTokens(opts.body),
    lines: opts.body.split('\n').length,
    modified: relativeTime(opts.modifiedMs),
    body: opts.body,
    readOnly: opts.readOnly,
    imports: opts.imports?.length ? opts.imports : undefined,
    host: opts.host,
  };
}

/** Id suffix for a non-default host, so both agents' files stay distinct. */
function idSuffix(profile: ServerHostProfile): string {
  return profile === HOST_PROFILES[0] ? '' : '-' + profile.id;
}

async function collectEnterprise(profile: ServerHostProfile): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];
  for (const p of profile.enterpriseMemoryPaths()) {
    const file = await tryRead(p);
    if (file) {
      out.push(makeFile({
        id: 'm-ent' + idSuffix(profile),
        level: 'enterprise',
        type: 'instruction',
        name: profile.memoryFile,
        scope: 'managed',
        absolutePath: p,
        body: file.body,
        modifiedMs: file.modified,
        readOnly: true,
        host: profile.id,
      }));
      break;
    }
  }
  return out;
}

async function collectUser(profile: ServerHostProfile): Promise<MemoryFile[]> {
  const p = path.join(os.homedir(), profile.configDir, profile.memoryFile);
  const file = await tryRead(p);
  if (!file) return [];
  return [makeFile({
    id: 'm-user' + idSuffix(profile),
    level: 'user',
    type: 'instruction',
    name: profile.memoryFile,
    scope: '~/' + profile.configDir,
    absolutePath: p,
    body: file.body,
    modifiedMs: file.modified,
    host: profile.id,
  })];
}

async function collectProject(projectRoot: string, profile: ServerHostProfile): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];
  const suffix = idSuffix(profile);
  const proj = path.join(projectRoot, profile.memoryFile);
  const projFile = await tryRead(proj);
  const importMap = new Map<string, MemoryFile>();
  if (projFile) {
    const imports = extractImports(projFile.body);
    const resolvedIds: string[] = [];
    for (const imp of imports) {
      const abs = path.isAbsolute(imp) ? imp : path.join(projectRoot, imp);
      const sub = await tryRead(abs);
      if (sub) {
        const id = 'm-imp-' + Buffer.from(imp).toString('base64').replace(/=/g, '').slice(0, 10) + suffix;
        importMap.set(imp, makeFile({
          id,
          level: 'import',
          type: 'import',
          name: path.basename(abs),
          scope: '@import',
          absolutePath: abs,
          body: sub.body,
          modifiedMs: sub.modified,
          host: profile.id,
        }));
        resolvedIds.push(id);
      }
    }
    out.push(makeFile({
      id: 'm-proj' + suffix,
      level: 'project',
      type: 'instruction',
      name: profile.memoryFile,
      scope: 'project root',
      absolutePath: proj,
      body: projFile.body,
      modifiedMs: projFile.modified,
      imports: resolvedIds,
      host: profile.id,
    }));
    for (const im of importMap.values()) out.push(im);
  }

  // Scan one level of subdirectories for nested memory files. Keeps the
  // walk cheap — going deeper would need ignoring node_modules etc.
  try {
    const entries = await fs.readdir(projectRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue;
      const subPath = path.join(projectRoot, ent.name, profile.memoryFile);
      const sub = await tryRead(subPath);
      if (sub) {
        out.push(makeFile({
          id: 'm-sub-' + ent.name + suffix,
          level: 'subdir',
          type: 'instruction',
          name: profile.memoryFile,
          scope: ent.name,
          absolutePath: subPath,
          body: sub.body,
          modifiedMs: sub.modified,
          host: profile.id,
        }));
      }
    }
  } catch {
    // Project root not readable — ignore, return what we already have.
  }
  return out;
}

async function collectNotes(profile: ServerHostProfile): Promise<MemoryFile[]> {
  const out: MemoryFile[] = [];
  if (!profile.notesDir) return out;
  const dir = path.join(os.homedir(), profile.notesDir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    const abs = path.join(dir, ent.name);
    const file = await tryRead(abs);
    if (!file) continue;
    const tags = Array.from(file.body.matchAll(/#([A-Za-z][A-Za-z0-9_-]*)/g))
      .map((m) => m[1])
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 6);
    out.push(makeFile({
      id: 'n-' + ent.name.replace(/\.md$/, '') + idSuffix(profile),
      level: 'note',
      type: 'note',
      name: ent.name,
      scope: 'memory tool',
      absolutePath: abs,
      body: file.body,
      modifiedMs: file.modified,
      host: profile.id,
    }));
    if (tags.length) {
      const last = out[out.length - 1];
      if (last) last.tags = tags;
    }
  }
  return out;
}

/**
 * Every agent's memory files, grouped tier by tier: enterprise, user, project,
 * notes — each tier lists Claude Code's files, then Gemini CLI's.
 */
export async function collectMemoryFiles(projectRoot: string | null): Promise<MemoryFile[]> {
  const tiers = await Promise.all([
    Promise.all(HOST_PROFILES.map((p) => collectEnterprise(p))),
    Promise.all(HOST_PROFILES.map((p) => collectUser(p))),
    projectRoot ? Promise.all(HOST_PROFILES.map((p) => collectProject(projectRoot, p))) : Promise.resolve<MemoryFile[][]>([]),
    Promise.all(HOST_PROFILES.map((p) => collectNotes(p))),
  ]);
  return tiers.flat(2);
}

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/memory', async (req: FastifyRequest<{ Querystring: { project?: string; projectPath?: string } }>) => {
    // Memory has three global tiers (enterprise / user / notes) and one
    // project tier. The global tiers always render; the project tier
    // requires a project path. We try, in order:
    //   1. The `?project=<slug>` query arg (decoded from Claude's slug).
    //   2. The `?projectPath=` arg if the caller has the absolute path handy.
    //   3. The primary SpecShip's projectRoot, if configured at boot.
    // When none is available, the response just omits the project tier
    // (no 409 — the user can still see their global memory).
    let projectRoot: string | null = null;
    if (req.query.project) projectRoot = decodeProjectSlug(req.query.project);
    else if (req.query.projectPath) projectRoot = req.query.projectPath;
    else if (app.primaryCg?.getProjectRoot) projectRoot = app.primaryCg.getProjectRoot();

    const files = await collectMemoryFiles(projectRoot);

    const resp: MemoryResponse = {
      totalTokens: files.reduce((a, b) => a + b.tokens, 0),
      instructionCount: files.filter((f) => f.type === 'instruction').length,
      noteCount: files.filter((f) => f.type === 'note').length,
      importCount: files.filter((f) => f.type === 'import').length,
      files,
    };
    return resp;
  });
}

// Re-export the helper for tests
export const _testing = { expandHome, pathForUi, estimateTokens, extractImports };

/**
 * The shared tool-name set, as seen by the dashboard server (REQ-AGENTSWITCH-004).
 *
 * The values are NOT repeated here: they live in the core package's
 * `src/analytics/canonical-tools.json`, which `src/analytics/canonical-tools.ts`
 * imports. The server can neither compile against `src/` (its rootDir is
 * `server/src`) nor runtime-import the core package (a bare-package import
 * serves a stale build), so it reads the same JSON file from disk, once,
 * synchronously:
 *
 *   - bundled  — `dist/server/…` → `dist/analytics/canonical-tools.json`
 *                (tsc emits the imported JSON next to the core build);
 *   - workspace / tests — `server/{src,dist}/…` → `<repo>/src/analytics/canonical-tools.json`.
 *
 * A missing file throws: guessing tool names would silently zero every count.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface CanonicalToolsFile {
  mcpPrefix: string;
  mcpSeparator: string;
  specshipServer: string;
  tools: {
    read: string;
    write: string;
    edit: string;
    multiEdit: string;
    notebookEdit: string;
    bash: string;
    grep: string;
    glob: string;
  };
}

const FILE = 'canonical-tools.json';

function locate(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    for (const rel of [path.join('analytics', FILE), path.join('src', 'analytics', FILE)]) {
      const candidate = path.join(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`[canonical-tools] ${FILE} not found above ${fileURLToPath(import.meta.url)}`);
}

const data = JSON.parse(readFileSync(locate(), 'utf-8')) as CanonicalToolsFile;

/** Shared built-in tool names, keyed by role. */
export const CANONICAL_TOOLS: Readonly<CanonicalToolsFile['tools']> = Object.freeze({ ...data.tools });

/** Shared name of an MCP tool: `<prefix><server><separator><tool>`. */
export function canonicalMcpToolName(server: string, tool: string): string {
  return `${data.mcpPrefix}${server}${data.mcpSeparator}${tool}`;
}

/** Prefix every shared SpecShip MCP tool name starts with. */
export const specshipToolPrefix: string = canonicalMcpToolName(data.specshipServer, '');

/** Prefix every shared MCP tool name starts with (any server). */
export const MCP_TOOL_PREFIX: string = data.mcpPrefix;

/** Separator between server and tool in a shared MCP tool name. */
export const MCP_TOOL_SEPARATOR: string = data.mcpSeparator;

/** The SpecShip MCP server's name. */
export const specshipServerName: string = data.specshipServer;

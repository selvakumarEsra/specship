/**
 * The shared tool-name set (REQ-AGENTSWITCH-004).
 *
 * Every transcript adapter maps its agent's tool names onto these before
 * anything counts them, so analytics, reflect mining and the explore "prior
 * work" section never name one agent's tools. The values live in
 * `canonical-tools.json` — the single source the dashboard server reads too
 * (`server/src/canonical-tools.ts`), since the server can neither compile
 * against `src/` nor runtime-import the core package.
 */
import data from './canonical-tools.json';

export interface CanonicalToolNames {
  read: string;
  write: string;
  edit: string;
  multiEdit: string;
  notebookEdit: string;
  bash: string;
  grep: string;
  glob: string;
}

/** Shared built-in tool names, keyed by role. */
export const CANONICAL_TOOLS: Readonly<CanonicalToolNames> = Object.freeze({ ...data.tools });

/** Shared name of an MCP tool: `<prefix><server><separator><tool>`. */
export function canonicalMcpToolName(server: string, tool: string): string {
  return `${data.mcpPrefix}${server}${data.mcpSeparator}${tool}`;
}

/** Prefix every shared SpecShip MCP tool name starts with. */
export const specshipToolPrefix: string = canonicalMcpToolName(data.specshipServer, '');

/** Prefix every shared MCP tool name starts with (any server). */
export const MCP_TOOL_PREFIX: string = data.mcpPrefix;

/** Tools that change a file. */
export const FILE_WRITE_TOOLS: readonly string[] = [CANONICAL_TOOLS.edit, CANONICAL_TOOLS.write];

/** `'A','B'` — a SQL IN-list of tool names (the names are fixed identifiers, never user input). */
export function sqlToolList(names: readonly string[]): string {
  return names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
}

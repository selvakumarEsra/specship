/**
 * Agent-neutral transcript helpers shared by every transcript adapter
 * (REQ-AGENTSWITCH-017): timestamp normalisation and the one-line tool-input
 * summary the heatmap, tips and reflect read.
 */

/** Convert a timestamp field (ISO string or epoch number) to epoch ms. */
export function toEpochMs(ts: string | number | undefined): number {
  if (ts == null) return Date.now();
  if (typeof ts === 'number') {
    // Heuristic: 10-digit values are seconds, 13-digit are ms.
    return ts > 1e12 ? ts : ts * 1000;
  }
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * For a tool_use block, build a short, format-aware input summary:
 *   - Read/Edit/Write → file path
 *   - Bash → first 200 chars of command
 *   - others → JSON of input, truncated to 200 chars
 *
 * This is what shows up in the heatmap drill-down and the tips engine.
 */
export function summarizeToolInput(name: string, input: Record<string, unknown> | undefined): string {
  if (!input || typeof input !== 'object') return '';
  const n = name.toLowerCase();
  // File-targeted tools
  if (n === 'read' || n === 'edit' || n === 'write' || n === 'notebookedit') {
    const p = (input.file_path ?? input.path ?? input.notebook_path) as string | undefined;
    if (typeof p === 'string') return p.slice(0, 400);
  }
  if (n === 'glob') {
    const p = (input.pattern ?? input.glob) as string | undefined;
    if (typeof p === 'string') return p.slice(0, 400);
  }
  if (n === 'grep') {
    const p = (input.pattern ?? input.query) as string | undefined;
    if (typeof p === 'string') return p.slice(0, 400);
  }
  if (n === 'bash' || n === 'shell') {
    const c = (input.command ?? input.cmd) as string | undefined;
    if (typeof c === 'string') return c.slice(0, 400);
  }
  // MCP tool — input.tool_name + JSON keys
  try {
    const j = JSON.stringify(input);
    return j.length > 400 ? j.slice(0, 400) + '…' : j;
  } catch {
    return '';
  }
}

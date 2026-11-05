/**
 * Gemini CLI version probe and the version-dependent MCP tool-name form
 * (REQ-AGENTSWITCH-018). Gemini CLI 0.33.0 renamed MCP tools from
 * `<server>__<tool>` to `mcp_<server>_<tool>`; verified against
 * gemini-cli-core 0.32.1, 0.33.0 and 0.67.0 (`isValidToolName`,
 * `formatMcpToolName`).
 */

import { spawnSync } from 'child_process';

/** First Gemini CLI release that names MCP tools `mcp_<server>_<tool>`. */
export const GEMINI_MCP_PREFIX_SINCE = '0.33.0';

/**
 * Probe the installed Gemini CLI's version (`gemini --version`). Returns
 * `null` when Gemini is not on PATH or prints no version. `SPECSHIP_GEMINI_VERSION`
 * overrides the probe (tests, and users whose `gemini` is not on PATH);
 * `none` or an empty value means "not found". The real probe is memoised per
 * process — it costs about a second.
 */
let probedGeminiVersion: string | null | undefined;
export function probeGeminiVersion(): string | null {
  const override = process.env.SPECSHIP_GEMINI_VERSION;
  if (override !== undefined) {
    const v = override.trim();
    return v === '' || v.toLowerCase() === 'none' ? null : v;
  }
  if (probedGeminiVersion !== undefined) return probedGeminiVersion;
  let found: string | null = null;
  try {
    const res = spawnSync('gemini', ['--version'], {
      encoding: 'utf-8',
      windowsHide: true,
      // Short: this also runs inside automatic agent set-up (MCP sessions, git hooks).
      timeout: 3000,
      shell: process.platform === 'win32',
    });
    if (res.status === 0) {
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(res.stdout ?? ''));
      if (m) found = m[0];
    }
  } catch {
    found = null;
  }
  probedGeminiVersion = found;
  return found;
}

/** True when `version` (x.y.z, any suffix ignored) is at least `min`. */
export function geminiVersionSupports(version: string | null, min: string): boolean {
  if (!version) return false;
  const parse = (v: string): number[] | null => {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
}

/**
 * The name the installed Gemini CLI gives an MCP server's tool. An unknown
 * version gets the current form (REQ-AGENTSWITCH-018).
 */
export function geminiMcpToolName(server: string, tool: string, version: string | null): string {
  if (version && !geminiVersionSupports(version, GEMINI_MCP_PREFIX_SINCE)) return `${server}__${tool}`;
  return `mcp_${server}_${tool}`;
}

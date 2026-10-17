/**
 * Session cheat-sheet (CHEATSHEET-DOC).
 *
 * SpecShip's agent-facing guidance ships in the MCP `initialize` response, so
 * Claude always knows how to drive the tools. The human driving the session
 * has no equivalent. This module is the human's map — a short, static
 * capability cheat-sheet printed at session start as a `SessionStart` hook
 * `systemMessage` (the command is `specship cheatsheet`, installed by the
 * installer and shipped in the plugin's `hooks/hooks.json`).
 *
 * Distinct from `starter-prompt` (a dynamic, self-silencing first-run flow
 * prompt) and from the dashboard's improvement tips (`claude_tip_state`) — see
 * the spec's scope note. Noise is bounded by the hook matcher (startup only)
 * and the `SPECSHIP_NO_CHEATSHEET` opt-out below, not by this module.
 */

/**
 * The cheat-sheet rendered to the user. Names only user-facing commands, tools,
 * and env vars — no internal file paths, symbol names, or benchmark figures
 * (REQ-CHEAT-002.A3), so it reads as a product map rather than engineering
 * notes.
 */
export const CHEATSHEET_TEXT = [
  '📦 SpecShip — code intelligence + spec-driven flow over the indexed graph',
  '',
  'The four doors (slash commands):',
  '• /specship:explore  — reads door. "how does X work / reach Y", blast radius.',
  '• /specship:spec     — intent door. list · new · fast · design · implement · review.',
  '• /specship:check    — gate & health door (drift queue, fix, relink, health).',
  '• /specship:learn    — lessons door. crystallize what worked into a skill proposal.',
  '',
  'Explore before you Read/Grep:',
  '• specship_explore is PRIMARY — one call returns verbatim source grouped by file.',
  '• Flow: name both ends (e.g. "mutateElement renderScene") to trace the call path.',
  '• Locate → specship_search · impact → specship_impact · callers/callees too.',
  '',
  'JIRA: "my JIRA issues", "pick PROJ-123", "start it", "publish REQ-X to JIRA".',
  'Drift & health: /specship:check · check drifted · check fix <ID> · check health.',
  'Lessons & memory: /specship:learn; auto-memory has four types (user · feedback ·',
  '  project · reference) that persist across sessions.',
  'Verify: the gate runs the spec→test→verify chain; specship_link_verify closes a link.',
  '',
  'Silence this with SPECSHIP_NO_CHEATSHEET=1. specship_status shows index freshness.',
].join('\n');

/**
 * Build the `SessionStart`-hook payload the `specship cheatsheet` command
 * prints. Returns `{ systemMessage }` (user-visible only — never
 * `additionalContext`, REQ-CHEAT-001.A2), or `null` when the user has opted
 * out via `SPECSHIP_NO_CHEATSHEET` (REQ-CHEAT-004.A1). An unset or empty
 * variable prints normally (REQ-CHEAT-004.A2).
 */
export function buildCheatsheetPayload(
  env: NodeJS.ProcessEnv = process.env,
  extras: CheatsheetExtras = {},
): { systemMessage: string } | null {
  if (env.SPECSHIP_NO_CHEATSHEET) return null;
  const parts = [CHEATSHEET_TEXT];
  // Learned project conventions (REQ-ALEARN-002): absent/empty file → output
  // is byte-identical to the base cheatsheet (A1).
  if (extras.conventions) {
    const section = renderConventionsSection(extras.conventions, CONVENTIONS_BUDGET_LINES);
    if (section) parts.push('', section);
  }
  // Open learned proposals awaiting review (REQ-ALEARN-004.A2): one line,
  // only when the count is positive.
  if (extras.openProposals && extras.openProposals > 0) {
    parts.push(
      '',
      `🧠 ${extras.openProposals} learned proposal(s) awaiting review — run \`specship reflect\` to review them.`,
    );
  }
  return { systemMessage: parts.join('\n') };
}

/** Optional learned-state extras the CLI resolves before rendering. */
export interface CheatsheetExtras {
  /** Raw content of .specship/conventions.md (null/empty → no section). */
  conventions?: string | null;
  /** Count of open reflection proposals (0/undefined → no line). */
  openProposals?: number;
}

/** Max convention bullets injected per session (REQ-ALEARN-002.A2). */
export const CONVENTIONS_BUDGET_LINES = 8;

/**
 * Render the confirmed conventions as a budget-bounded cheatsheet section
 * (REQ-ALEARN-002). Rules are the `## <title>` lines of the SpecShip-written
 * marker blocks plus their first body line; over budget, the rest collapse
 * into a "+N more" pointer. No blocks → empty string (nothing injected).
 */
export function renderConventionsSection(content: string, budget: number): string {
  const rules: string[] = [];
  const re = /<!-- SPECSHIP_LEARNING:[^>]+ -->\n## ([^\n]+)\n+([^\n<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const title = (m[1] ?? '').replace(/^Convention:\s*/i, '').trim();
    const body = (m[2] ?? '').trim();
    // The body line is the rule; the title is a summary of it. Prefer the
    // body (the user's own words), fall back to the title.
    rules.push(body || title);
  }
  if (rules.length === 0) return '';
  const shown = rules.slice(0, budget);
  const lines = ['Project conventions (learned — .specship/conventions.md):'];
  for (const r of shown) lines.push(`• ${r.length > 100 ? r.slice(0, 97) + '…' : r}`);
  if (rules.length > shown.length) {
    lines.push(`  +${rules.length - shown.length} more — see .specship/conventions.md`);
  }
  return lines.join('\n');
}

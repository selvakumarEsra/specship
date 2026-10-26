/**
 * Marker constants for the legacy agent-instructions block.
 *
 * Specship used to write a `## SpecShip` usage guide into each
 * agent's instructions file (CLAUDE.md / AGENTS.md / GEMINI.md /
 * specship.mdc / Kiro steering doc). That duplicated the guidance the
 * MCP server already emits in its `initialize` response — every agent
 * read the same playbook twice each turn (issue #529). The installer no
 * longer writes an instructions file; the MCP server instructions in
 * `mcp/server-instructions.ts` are the single source of truth.
 *
 * These markers are retained so install (self-heal on upgrade) and
 * uninstall can find and strip the block a previous install wrote.
 */

/** Markers used by the marker-based section removal. */
export const SPECSHIP_SECTION_START = '<!-- SPECSHIP_START -->';
export const SPECSHIP_SECTION_END = '<!-- SPECSHIP_END -->';

/**
 * Markers for the spec-driven-development steering block (SDD-INSTALL-DOC).
 *
 * DISTINCT from the legacy `SPECSHIP_START/END` pair on purpose: this block is
 * a tiny ordering RULE, not the MCP tool playbook that #529 removed. Keeping
 * its own markers lets install/uninstall manage it independently and never
 * resurrects the duplicated-instructions problem.
 */
export const SPECSHIP_SDD_SECTION_START = '<!-- SPECSHIP_SDD_START -->';
export const SPECSHIP_SDD_SECTION_END = '<!-- SPECSHIP_SDD_END -->';

/**
 * The spec-driven-development steering rules written into the project CLAUDE.md.
 * A repo's CLAUDE.md takes precedence over a skill's own description, so these
 * deterministically flip feature/bug work to spec-author-first, and steer
 * claude.ai/design links to the design sub-route. Kept to ordering rules only —
 * they MUST NOT duplicate the MCP server instructions.
 */
/**
 * Markers for the Gemini CLI retrieval-preference block (REQ-GEMINI-004).
 *
 * Distinct from the legacy `SPECSHIP_START/END` pair on purpose. That pair is
 * strip-only (the #529 MCP playbook, which stays in `server-instructions.ts`
 * alone). This pair wraps the retrieval ORDERING rule the Gemini target writes
 * into GEMINI.md: a single sentence naming the `specship_*` MCP tools as the
 * first stop before Gemini's own `grep_search` / `glob` / `read_file` / shell
 * `run_shell_command` search for structure / flow / "where is X" questions.
 * No tool playbook — Gemini CLI forwards the MCP server's `initialize`
 * instructions to the model (`McpClient.getInstructions`, verified in 0.28.0),
 * so `server-instructions.ts` stays the single source of truth.
 */
export const SPECSHIP_GEMINI_RETRIEVAL_START = '<!-- SPECSHIP_GEMINI_RETRIEVAL_START -->';
export const SPECSHIP_GEMINI_RETRIEVAL_END = '<!-- SPECSHIP_GEMINI_RETRIEVAL_END -->';

/**
 * The retrieval-preference block the Gemini target writes into GEMINI.md
 * (REQ-GEMINI-004). An ORDERING RULE only — it must not restate the MCP tool
 * playbook (the A3 test asserts no shared paragraph with
 * `getServerInstructions`).
 */
export function getGeminiRetrievalBlock(): string {
  return [
    SPECSHIP_GEMINI_RETRIEVAL_START,
    '## SpecShip retrieval',
    '',
    'When the project has a SpecShip index (a `.specship/` folder), questions',
    'about code structure, call flow, "where is X defined", "who calls X", or',
    '"what breaks if I change X" go to the `specship_*` MCP tools FIRST —',
    'before `grep_search`, `glob`, `read_file`, or a search command run through',
    '`run_shell_command`. The MCP server itself tells you which tool to pick',
    'and how to call it.',
    SPECSHIP_GEMINI_RETRIEVAL_END,
  ].join('\n');
}

export function getSddRuleBlock(): string {
  return [
    SPECSHIP_SDD_SECTION_START,
    '## Spec-driven development (SpecShip)',
    '',
    "For feature or bug work in this repo, FIRST invoke SpecShip's **spec-author**",
    'to author the spec under `specs/` — before any brainstorming or planning skill.',
    'Spec-driven development is canonical here: the spec is the contract, and the',
    'implementation follows from it (`/specship:spec implement`). This rule intentionally takes',
    "precedence over a skill's own \"use me first\" guidance.",
    '',
    'When the user shares a **claude.ai/design** link (or references a Claude Design',
    'project), recommend **`/specship:spec design`** first and get explicit confirmation',
    'before proceeding — even mid spec-author. That is the design→code path: taste',
    'the design with the user → snapshot → spec → review → `/specship:spec implement`.',
    SPECSHIP_SDD_SECTION_END,
  ].join('\n');
}

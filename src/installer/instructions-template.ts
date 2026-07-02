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
 * claude.ai/design links to the design loop. Kept to ordering rules only — they
 * MUST NOT duplicate the MCP server instructions.
 */
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
    'project), recommend **`/specship:design-loop`** first and get explicit confirmation',
    'before proceeding — even mid spec-author. That is the design→code path: taste',
    'the design with the user → snapshot → spec → review → `/specship:spec implement`.',
    SPECSHIP_SDD_SECTION_END,
  ].join('\n');
}

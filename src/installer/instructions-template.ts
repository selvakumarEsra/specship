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
 * The spec-driven-development steering rule written into the project CLAUDE.md.
 * A repo's CLAUDE.md takes precedence over a skill's own description, so this
 * deterministically flips feature/bug work to spec-author-first. Kept to the
 * ordering rule only — it MUST NOT duplicate the MCP server instructions.
 */
export function getSddRuleBlock(): string {
  return [
    SPECSHIP_SDD_SECTION_START,
    '## Spec-driven development (SpecShip)',
    '',
    "For feature or bug work in this repo, FIRST invoke SpecShip's **spec-author**",
    'to author the spec under `specs/` — before any brainstorming or planning skill.',
    'Spec-driven development is canonical here: the spec is the contract, and the',
    'implementation follows from it (`/ss-implement`). This rule intentionally takes',
    "precedence over a skill's own \"use me first\" guidance.",
    SPECSHIP_SDD_SECTION_END,
  ].join('\n');
}

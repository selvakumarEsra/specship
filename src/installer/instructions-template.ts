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

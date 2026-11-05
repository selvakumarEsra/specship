/**
 * Host literals still allowed in shared code (REQ-AGENTSWITCH-001.A1/A2).
 *
 * Each entry is one (file, literal) pair with a one-line reason. An entry
 * that names a requirement is a known leak that requirement removes: when it
 * lands, it deletes its entries here. The guard fails on any hit not listed
 * AND on any entry that no longer matches a hit, so this file cannot drift.
 */
import type { AllowlistEntry } from '../helpers/host-literal-scan';

const WORKFLOW_TOOLS =
  'allowed_tools vocabulary: Claude Code tool names are the canonical step-tool names; ' +
  'src/workflows/agents/gemini.ts translateGeminiTools maps them per agent';

export const HOST_LITERAL_ALLOWLIST: readonly AllowlistEntry[] = [
  // ── Owned by REQ-AGENTSWITCH-003 (memory-file audit + reflect proposals) ──
  { file: 'src/claudemd/audit.ts', literal: 'CLAUDE.md', count: 7, reason: 'owned by REQ-AGENTSWITCH-003 — memory-file audit covers only CLAUDE.md' },
  { file: 'src/bin/specship.ts', literal: 'CLAUDE.md', count: 4, reason: 'owned by REQ-AGENTSWITCH-003 — audit and reflect CLI messages name CLAUDE.md' },
  { file: 'src/reflect/miner.ts', literal: 'CLAUDE.md', count: 2, reason: 'owned by REQ-AGENTSWITCH-003 — reflect proposal text names CLAUDE.md' },
  { file: 'src/reflect/targets.ts', literal: 'CLAUDE.md', count: 1, reason: 'owned by REQ-AGENTSWITCH-003 — reflect proposals write the project CLAUDE.md' },

  // ── Owned by REQ-AGENTSWITCH-004 (per-agent transcript adapters) ──
  { file: 'src/analytics/specship-impact.ts', literal: 'mcp__specship__', count: 1, reason: 'owned by REQ-AGENTSWITCH-004 — transcript adapters (analytics matches Claude tool names)' },
  { file: 'server/src/ingest/specship-classify.ts', literal: 'mcp__specship__', count: 1, reason: 'owned by REQ-AGENTSWITCH-004 — transcript adapters (ingest classifies Claude tool names)' },
  { file: 'server/src/routes/claude.ts', literal: '.claude/', count: 1, reason: 'owned by REQ-AGENTSWITCH-004 — transcript adapters (Claude session analytics advice)' },

  // ── Historical: shipped migrations never change ──
  { file: 'src/db/migrations.ts', literal: '.claude/', count: 1, reason: 'historical migration description for the Claude transcript tables; migrations are immutable' },
  { file: 'src/db/migrations.ts', literal: 'mcp__specship__', count: 1, reason: 'historical migration backfill over Claude transcript rows; migrations are immutable' },

  // ── Bundled workflows: step tool lists ──
  { file: 'src/workflows/defaults/claude-design-implement.yaml', literal: 'mcp__specship__', count: 8, reason: WORKFLOW_TOOLS },
  { file: 'src/workflows/defaults/spec-author.yaml', literal: 'mcp__specship__', count: 9, reason: WORKFLOW_TOOLS },
  { file: 'src/workflows/defaults/spec-fix.yaml', literal: 'mcp__specship__', count: 8, reason: WORKFLOW_TOOLS },
  { file: 'src/workflows/defaults/spec-implement.yaml', literal: 'mcp__specship__', count: 19, reason: WORKFLOW_TOOLS },
  { file: 'src/workflows/defaults/spec-relink.yaml', literal: 'mcp__specship__', count: 5, reason: WORKFLOW_TOOLS },
  { file: 'src/workflows/defaults/spec-verify.yaml', literal: 'mcp__specship__', count: 3, reason: WORKFLOW_TOOLS },
];

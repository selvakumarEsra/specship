/**
 * Host literals still allowed in shared code (REQ-AGENTSWITCH-001.A1/A2).
 *
 * Each entry is one (file, literal) pair with a one-line reason. An entry
 * that names a requirement is a known leak that requirement removes: when it
 * lands, it deletes its entries here. The guard fails on any hit not listed
 * AND on any entry that no longer matches a hit, so this file cannot drift.
 */
import type { AllowlistEntry } from '../helpers/host-literal-scan';

// Empty: shared code carries no host literals. Workflow steps name SpecShip
// tools by their bare server name and each headless adapter qualifies them
// (qualifyClaudeTools / translateGeminiTools); the SpecShip prefix the
// migrations backfill over is the canonical shared tool name. A new entry
// needs a reason a reviewer accepts — the default answer is an adapter.
export const HOST_LITERAL_ALLOWLIST: readonly AllowlistEntry[] = [];

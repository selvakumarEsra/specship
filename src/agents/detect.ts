/**
 * Current-agent detection (AGENTSWITCH-DOC, REQ-AGENTSWITCH-007).
 *
 * Works out which coding agent SpecShip is serving from the evidence that
 * agent supplies: the MCP client name at `initialize`, a hook payload's event
 * name, and the launcher environment variables of the agent's shell.
 *
 * This module is agent-neutral (REQ-AGENTSWITCH-001): it holds no host
 * literals. Each host declares its own client names, exclusive hook events
 * and launcher check on its adapter in `src/workflows/agents/`, and detection
 * iterates that registry. Evidence matching no adapter — or more than one —
 * yields {@link UNKNOWN_AGENT}. Every function here is pure: detection never
 * writes or installs anything, so "unknown" cannot trigger a change.
 */

import { headlessAgents } from '../workflows/agents';

/** The detection result when the evidence proves no single agent. */
export const UNKNOWN_AGENT = 'unknown';

/** An adapter id (same ids as the install record), or {@link UNKNOWN_AGENT}. */
export type DetectedAgent = string;

/** The single adapter matching `pred`, else unknown (none or ambiguous). */
function uniqueMatch(pred: (a: ReturnType<typeof headlessAgents>[number]) => boolean): DetectedAgent {
  const hits = headlessAgents().filter(pred);
  return hits.length === 1 ? hits[0]!.id : UNKNOWN_AGENT;
}

/** The agent behind an MCP `initialize` `clientInfo`, matched by exact name. */
export function agentFromMcpClient(clientInfo?: { name?: unknown } | null): DetectedAgent {
  const name = clientInfo?.name;
  if (typeof name !== 'string' || !name) return UNKNOWN_AGENT;
  return uniqueMatch((a) => a.mcpClientNames.includes(name));
}

/**
 * The agent behind a hook event name. Only events a single host sends count;
 * shared events (session start) and missing names are unknown.
 */
export function agentFromHookEvent(eventName?: string | null): DetectedAgent {
  if (!eventName) return UNKNOWN_AGENT;
  return uniqueMatch((a) => a.exclusiveHookEvents.includes(eventName));
}

/** The agent whose launcher environment variables are set; unknown if none or several. */
export function agentFromEnv(env: NodeJS.ProcessEnv = process.env): DetectedAgent {
  return uniqueMatch((a) => a.launchedFrom(env));
}

/** A detected agent's human-readable name; `unknown` for unknown or unlisted ids. */
export function agentDisplayName(agent: DetectedAgent): string {
  return headlessAgents().find((a) => a.id === agent)?.displayName ?? UNKNOWN_AGENT;
}

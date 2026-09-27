/**
 * MCP tool: specship_health (REQ-SURF-007).
 *
 * One code-health door. Folds the former `specship_maintainability`
 * (MAINT-DOC) and `specship_fitness` (FITNESS-DOC) tools into a single surface
 * with a `checks` filter — two tools answering "is this codebase healthy?" made
 * the agent pick between them, and it under-picked both. The two renderers stay
 * where they are; this composes them.
 *
 * Config is untouched: both reports still read `specship.config.json`
 * (`maintainability.thresholds`, `fitness.rules`), and the CLI enforce/check
 * paths call the library directly, not this tool.
 */
import type { SpecShip } from '../index';
import type { ToolDefinition, ToolResult } from './tools';
import { handleSpecshipMaintainability } from './maintainability-tool';
import { handleSpecshipFitness } from './fitness-tool';

export const HEALTH_CHECKS = ['maintainability', 'fitness'] as const;
export type HealthCheck = (typeof HEALTH_CHECKS)[number];

export const healthToolDefinitions: ToolDefinition[] = [
  {
    name: 'specship_health',
    description:
      'Report code health from the graph: maintainability signals (coupling hotspots by fan-in/out, oversized symbols + god-files, dependency cycles, dead-code candidates) and architecture-fitness violations (forbidden dependencies, layering allow-lists, module isolation) with file:line. Deterministic, no new parse. Returns both by default; pass `checks` to narrow. Thresholds and rules come from specship.config.json (maintainability.thresholds, fitness.rules).',
    inputSchema: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          description: 'Which reports to include: "maintainability", "fitness". Omit for both.',
          items: { type: 'string' },
        },
        projectPath: {
          type: 'string',
          description: 'Path to a different project with .specship/ initialized. Omit for the current project.',
        },
      },
    },
  },
];

/**
 * Normalize the `checks` filter. Anything unrecognized (or absent) falls back
 * to both reports — a filter typo must not silently return an empty health
 * report.
 */
export function resolveHealthChecks(raw: unknown): HealthCheck[] {
  const requested = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const picked = HEALTH_CHECKS.filter((c) =>
    requested.some((r) => typeof r === 'string' && r.trim().toLowerCase() === c)
  );
  return picked.length > 0 ? picked : [...HEALTH_CHECKS];
}

export async function handleSpecshipHealth(
  cg: SpecShip,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const checks = resolveHealthChecks(args.checks);
  const sections: string[] = [];
  for (const check of checks) {
    const r =
      check === 'maintainability'
        ? await handleSpecshipMaintainability(cg, args)
        : await handleSpecshipFitness(cg, args);
    sections.push(r.content.map((c) => c.text).join('\n'));
  }
  return { content: [{ type: 'text', text: sections.join('\n\n') }] };
}

/**
 * MCP tool: specship_fitness (REQ-FITNESS-003.A3).
 *
 * Returns the architecture-fitness evaluation to the agent — violations of the
 * declared rules plus any config errors — so it can check conformance before
 * committing. Type-only imports keep this free of a runtime cycle with tools.ts.
 */
import type { SpecShip } from '../index';
import type { ToolDefinition, ToolResult } from './tools';

export const fitnessToolDefinitions: ToolDefinition[] = [
  {
    name: 'specship_fitness',
    description:
      'Evaluate the project\'s architecture-fitness rules (specship.config.json `fitness.rules`) against the code graph: forbidden dependencies, layering allow-lists, module isolation. Returns concrete violations (source → target, file:line) plus config errors (a rule whose selector matches nothing). Use to check architecture conformance before committing.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to a different project with .specship/ initialized. Omit for the current project.',
        },
      },
    },
  },
];

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });

const CAP = 30;

export async function handleSpecshipFitness(
  cg: SpecShip,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const r = cg.getFitness();
  if (r.ruleCount === 0) {
    return text('# Architecture fitness\n\nNo rules declared. Add a `fitness.rules` array to `specship.config.json` (types: forbidden, layers, isolation).');
  }
  if (r.clean) {
    return text(`# Architecture fitness\n\n✓ All ${r.ruleCount} rule(s) pass.`);
  }
  const lines: string[] = ['# Architecture fitness'];
  if (r.configErrors.length) {
    lines.push('', `## Config errors (${r.configErrors.length})`);
    for (const e of r.configErrors) lines.push(`- **${e.rule}**: ${e.message}`);
  }
  if (r.violations.length) {
    lines.push('', `## Violations (${r.violations.length})`);
    for (const v of r.violations.slice(0, CAP)) {
      lines.push(`- [${v.rule}] \`${v.source}\` → \`${v.target}\` — ${v.detail} (${v.location})`);
    }
    if (r.violations.length > CAP) lines.push(`- …and ${r.violations.length - CAP} more`);
  }
  return text(lines.join('\n'));
}

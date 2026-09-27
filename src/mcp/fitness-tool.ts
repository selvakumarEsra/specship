/**
 * Architecture-fitness report handler (REQ-FITNESS-003.A3).
 *
 * The menu slot moved to the merged `specship_health` (REQ-SURF-007); this
 * handler stays so `execute()` keeps answering clients holding a cached
 * `specship_fitness` tool list.
 */
import type { SpecShip } from '../index';
import type { ToolResult } from './tools';

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

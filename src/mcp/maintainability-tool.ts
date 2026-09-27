/**
 * Maintainability report handler (REQ-MAINT-003).
 *
 * The menu slot moved to the merged `specship_health` (REQ-SURF-007); this
 * handler stays so `execute()` keeps answering clients holding a cached
 * `specship_maintainability` tool list.
 */
import type { SpecShip } from '../index';
import type { ToolResult } from './tools';

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });

const CAP = 15;

export async function handleSpecshipMaintainability(
  cg: SpecShip,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const r = cg.getMaintainability();
  if (r.clean) {
    return text('# Maintainability\n\n✨ Clean — nothing past threshold.');
  }
  const t = r.thresholds;
  const lines: string[] = ['# Maintainability'];
  lines.push(
    `_thresholds: fan-in/out ≥ ${t.highDegree} · symbol ≥ ${t.largeSymbolLines} lines · god-file ≥ ${t.godFileSymbols} symbols (override in specship.config.json)_`,
    '',
  );

  if (r.coupling.length) {
    lines.push(`## Coupling hotspots (${r.coupling.length})`);
    for (const c of r.coupling.slice(0, CAP)) lines.push(`- \`${c.name}\` — ${c.reason} — ${c.filePath}`);
    lines.push('');
  }
  if (r.oversized.length) {
    lines.push(`## Oversized symbols (${r.oversized.length})`);
    for (const o of r.oversized.slice(0, CAP)) lines.push(`- \`${o.name}\` — ${o.reason} — ${o.filePath}`);
    lines.push('');
  }
  if (r.godFiles.length) {
    lines.push(`## God files (${r.godFiles.length})`);
    for (const f of r.godFiles.slice(0, CAP)) lines.push(`- ${f.filePath} — ${f.reason}`);
    lines.push('');
  }
  if (r.cycles.length) {
    lines.push(`## Dependency cycles (${r.cycles.length})`);
    for (const c of r.cycles.slice(0, CAP)) lines.push(`- ${c.files.join(' → ')}`);
    lines.push('');
  }
  if (r.deadCode.length) {
    lines.push(`## Dead-code candidates (${r.deadCode.length})`);
    for (const d of r.deadCode.slice(0, CAP)) lines.push(`- \`${d.name}\` — ${d.filePath}:${d.startLine}`);
    if (r.deadCode.length > CAP) lines.push(`- …and ${r.deadCode.length - CAP} more (dead-code is heuristic; verify before removing)`);
    lines.push('');
  }
  return text(lines.join('\n').trimEnd());
}

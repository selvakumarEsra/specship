/**
 * Keeping design.md current (DESIGNMD-DOC, REQ-DESIGNMD-003).
 *
 * Re-extraction swaps only the marker-fenced generated block; every authored
 * byte outside it survives. What moved — tokens and inventory values added,
 * removed or changed — is written as one dated Change log entry, so a reader
 * (or a model revising the UI) sees exactly what to update. Nothing changed →
 * no entry, byte-identical file.
 */

import { GENERATED_END, GENERATED_START } from './render';

export class DesignMdUpdateError extends Error {}

export interface BlockSpan {
  start: number;
  end: number;
  block: string;
}

/** Locate the generated block (markers included), or null. */
export function findGeneratedBlock(content: string): BlockSpan | null {
  const start = content.indexOf(GENERATED_START);
  const endMarker = content.indexOf(GENERATED_END, start + 1);
  if (start === -1 || endMarker === -1) return null;
  const end = endMarker + GENERATED_END.length;
  return { start, end, block: content.slice(start, end) };
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function unquote(c: string): string {
  return c.replace(/^`|`$/g, '');
}

/**
 * The comparable facts of a generated block: `token <name> on <selector>` and
 * `variable <name>` → value, `<Inventory>: <value>` → "" (presence only).
 */
export function blockFacts(block: string): Map<string, string> {
  const facts = new Map<string, string>();
  let section = '';
  let sub = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('### ')) {
      section = line.slice(4).trim();
      sub = '';
      continue;
    }
    if (line.startsWith('#### ')) {
      sub = line.slice(5).trim();
      continue;
    }
    if (!line.startsWith('| `')) continue;
    const c = cells(line);
    if (section.startsWith('Design tokens')) facts.set(`token ${unquote(c[0]!)} on ${c[2]!.replace(/`/g, '')}`, unquote(c[1]!));
    else if (section === 'Design variables') facts.set(`variable ${unquote(c[0]!)}`, unquote(c[1]!));
    else if (section === 'Value inventories' && sub) facts.set(`${sub}: ${unquote(c[0]!)}`, '');
  }
  return facts;
}

export interface InventoryDiff {
  added: string[];
  removed: string[];
  changed: { key: string; from: string; to: string }[];
}

export function diffInventories(oldBlock: string, newBlock: string): InventoryDiff {
  const before = blockFacts(oldBlock);
  const after = blockFacts(newBlock);
  const diff: InventoryDiff = { added: [], removed: [], changed: [] };
  for (const [key, value] of after) {
    if (!before.has(key)) diff.added.push(key);
    else if (before.get(key) !== value) diff.changed.push({ key, from: before.get(key)!, to: value });
  }
  for (const key of before.keys()) if (!after.has(key)) diff.removed.push(key);
  return diff;
}

function changeLogEntry(diff: InventoryDiff, date: string): string {
  const n = diff.added.length + diff.removed.length + diff.changed.length;
  const lines = [
    n === 0
      ? `- ${date}: source re-extracted; no token or inventory value changed (rules or outline may have).`
      : `- ${date}: source re-extracted; ${n} value change${n === 1 ? '' : 's'}.`,
  ];
  for (const c of diff.changed) lines.push(`  - changed ${c.key}: \`${c.from}\` → \`${c.to}\``);
  for (const a of diff.added) lines.push(`  - added ${a}`);
  for (const r of diff.removed) lines.push(`  - removed ${r}`);
  return lines.join('\n');
}

export interface UpdateResult {
  content: string;
  changed: boolean;
  diff: InventoryDiff;
}

/**
 * Replace the generated block of an existing design.md and log what moved.
 * Throws `DesignMdUpdateError` when the file has no markers — refusing beats
 * overwriting authored content (REQ-DESIGNMD-003.A3).
 */
export function updateDesignMd(existing: string, newBlock: string, date: string): UpdateResult {
  const span = findGeneratedBlock(existing);
  if (!span) {
    throw new DesignMdUpdateError(
      `no generated block found (expected ${GENERATED_START} … ${GENERATED_END}); refusing to overwrite authored content`,
    );
  }
  const empty: InventoryDiff = { added: [], removed: [], changed: [] };
  if (span.block === newBlock) return { content: existing, changed: false, diff: empty };

  const diff = diffInventories(span.block, newBlock);
  let content = existing.slice(0, span.start) + newBlock + existing.slice(span.end);
  const entry = changeLogEntry(diff, date);
  const heading = /^## Change log[ \t]*$/m.exec(content);
  if (heading) {
    const at = heading.index + heading[0].length;
    content = `${content.slice(0, at)}\n\n${entry}${content.slice(at).replace(/^\n+/, '\n')}`;
  } else {
    content = `${content.replace(/\n*$/, '')}\n\n## Change log\n\n${entry}\n`;
  }
  return { content, changed: true, diff };
}

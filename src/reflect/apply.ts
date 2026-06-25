/**
 * Apply pipeline (REQ-REFLECT-003 / 004 / 005).
 *
 * `previewProposal` is pure-read: it computes the before/after the apply would
 * produce and a diff, touching nothing on disk. `applyProposal` performs the
 * write — idempotently (re-applying an unchanged proposal returns `unchanged`)
 * and reversibly (every write is either a marker-bounded block or an
 * engine-owned file, so `undoProposal` removes exactly what apply added). A
 * new-file write whose path is already occupied by a non-engine file is refused
 * as a `conflict` rather than clobbering it.
 *
 * Marker-bounded writes reuse the installer's battle-tested upsert/remove
 * helpers; hooks merge structurally into `.claude/settings.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  atomicWriteFileSync,
  readJsonFile,
  removeMarkedSection,
  upsertMarkedSection,
  writeJsonFile,
} from '../installer/targets/shared';
import { learningMarkers, memoryNoteMarker } from './targets';
import { ApplyOutcome, PreviewResult, Proposal, UndoOutcome } from './types';

function readFileSafe(p: string): { exists: boolean; content: string } {
  try {
    return { exists: true, content: fs.readFileSync(p, 'utf-8') };
  } catch {
    return { exists: false, content: '' };
  }
}

/** Minimal line-based unified-style diff for the preview surface. */
export function lineDiff(before: string, after: string): string {
  if (before === after) return '(no change)';
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];
  const out: string[] = [];
  // Cheap common-prefix / common-suffix trim, then mark the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  for (let i = Math.max(0, start - 2); i < start; i++) out.push('  ' + a[i]);
  for (let i = start; i <= endA; i++) out.push('- ' + a[i]);
  for (let i = start; i <= endB; i++) out.push('+ ' + b[i]);
  for (let i = endA + 1; i <= Math.min(a.length - 1, endA + 2); i++) out.push('  ' + a[i]);
  return out.join('\n');
}

/** Whether a CLAUDE.md / command file already carries this proposal's marker. */
function hasMarker(content: string, id: string): boolean {
  const { start } = learningMarkers(id);
  return content.includes(start);
}

/** Compute the after-content of a marked-block upsert without writing. */
function previewMarkedUpsert(content: string, startMarker: string, endMarker: string, block: string): string {
  const s = content.indexOf(startMarker);
  const e = content.indexOf(endMarker);
  if (s !== -1 && e > s) {
    return content.substring(0, s) + block + content.substring(e + endMarker.length);
  }
  if (content.trim() === '') return block + '\n';
  return content.replace(/\s*$/, '') + '\n\n' + block + '\n';
}

const MEMORY_INDEX = (homeDir: string): string =>
  path.join(homeDir, '.claude', 'memory', 'MEMORY.md');

/**
 * Non-mutating preview of the change a proposal would make (REQ-REFLECT-003).
 */
export function previewProposal(p: Proposal): PreviewResult {
  const { payload, targetPath, targetKind } = p;
  const cur = readFileSafe(targetPath);

  if (payload.kind === 'claude_md') {
    const { start, end } = learningMarkers(payload.markerId);
    const after = previewMarkedUpsert(cur.content, start, end, payload.block);
    return { targetPath, targetKind, exists: cur.exists, before: cur.content, after, diff: lineDiff(cur.content, after) };
  }

  if (payload.kind === 'memory_note') {
    const conflict = cur.exists && !cur.content.includes(memoryNoteMarker(payload.slug));
    const after = conflict ? cur.content : payload.note;
    return {
      targetPath,
      targetKind,
      exists: cur.exists,
      before: cur.content,
      after,
      diff: conflict ? '(conflict: a non-SpecShip file already exists here)' : lineDiff(cur.content, after),
      conflict,
    };
  }

  if (payload.kind === 'command') {
    const conflict = cur.exists && !hasMarker(cur.content, p.contentHash);
    const after = conflict ? cur.content : payload.content;
    return {
      targetPath,
      targetKind,
      exists: cur.exists,
      before: cur.content,
      after,
      diff: conflict ? '(conflict: a non-SpecShip command already exists here)' : lineDiff(cur.content, after),
      conflict,
    };
  }

  // settings_hook — structural JSON merge preview.
  const settings = cur.exists ? readJsonFile(targetPath) : {};
  const merged = mergeHook(structuredClone(settings), payload.event, payload.matcher, payload.entry);
  const before = JSON.stringify(settings, null, 2);
  const after = JSON.stringify(merged, null, 2);
  return { targetPath, targetKind, exists: cur.exists, before, after, diff: lineDiff(before, after) };
}

/**
 * Apply a proposal — write its change idempotently and reversibly (REQ-REFLECT-004).
 */
export function applyProposal(p: Proposal, homeDir: string): ApplyOutcome {
  const { payload, targetPath } = p;

  if (payload.kind === 'claude_md') {
    const { start, end } = learningMarkers(payload.markerId);
    const res = upsertMarkedSection(targetPath, start, end, payload.block);
    return res === 'unchanged' ? 'unchanged' : 'applied';
  }

  if (payload.kind === 'memory_note') {
    const cur = readFileSafe(targetPath);
    if (cur.exists && !cur.content.includes(memoryNoteMarker(payload.slug))) return 'conflict';
    const noteUnchanged = cur.exists && cur.content === payload.note;
    if (!noteUnchanged) atomicWriteFileSync(targetPath, payload.note);
    const indexAdded = ensureIndexLine(MEMORY_INDEX(homeDir), payload.indexLine);
    return noteUnchanged && !indexAdded ? 'unchanged' : 'applied';
  }

  if (payload.kind === 'command') {
    const cur = readFileSafe(targetPath);
    if (cur.exists && !hasMarker(cur.content, p.contentHash)) return 'conflict';
    const { start, end } = learningMarkers(p.contentHash);
    const res = upsertMarkedSection(targetPath, start, end, payload.content.replace(/\n$/, ''));
    return res === 'unchanged' ? 'unchanged' : 'applied';
  }

  // settings_hook
  const settings = readFileSafe(targetPath).exists ? readJsonFile(targetPath) : {};
  const merged = mergeHook(structuredClone(settings), payload.event, payload.matcher, payload.entry);
  if (JSON.stringify(merged) === JSON.stringify(settings)) return 'unchanged';
  writeJsonFile(targetPath, merged);
  return 'applied';
}

/**
 * Undo a previously applied proposal — remove exactly what apply added
 * (REQ-REFLECT-004.A3). A never-applied proposal is a no-op.
 */
export function undoProposal(p: Proposal, homeDir: string): UndoOutcome {
  const { payload, targetPath } = p;

  if (payload.kind === 'claude_md') {
    const { start, end } = learningMarkers(payload.markerId);
    return removeMarkedSection(targetPath, start, end) === 'removed' ? 'undone' : 'noop';
  }

  if (payload.kind === 'memory_note') {
    const cur = readFileSafe(targetPath);
    let touched = false;
    if (cur.exists && cur.content.includes(memoryNoteMarker(payload.slug))) {
      try { fs.unlinkSync(targetPath); touched = true; } catch { /* ignore */ }
    }
    if (removeIndexLine(MEMORY_INDEX(homeDir), payload.indexLine)) touched = true;
    return touched ? 'undone' : 'noop';
  }

  if (payload.kind === 'command') {
    const { start, end } = learningMarkers(p.contentHash);
    return removeMarkedSection(targetPath, start, end) === 'removed' ? 'undone' : 'noop';
  }

  // settings_hook
  const cur = readFileSafe(targetPath);
  if (!cur.exists) return 'noop';
  const settings = readJsonFile(targetPath);
  const stripped = removeHook(structuredClone(settings), payload.event, payload.matcher, payload.entry);
  if (JSON.stringify(stripped) === JSON.stringify(settings)) return 'noop';
  writeJsonFile(targetPath, stripped);
  return 'undone';
}

// --- MEMORY.md index line helpers (idempotent add / clean remove) ---

function ensureIndexLine(indexPath: string, line: string): boolean {
  const cur = readFileSafe(indexPath);
  if (cur.exists && cur.content.includes(line)) return false;
  if (!cur.exists || cur.content.trim() === '') {
    atomicWriteFileSync(indexPath, `# Memory index\n\n${line}\n`);
    return true;
  }
  atomicWriteFileSync(indexPath, cur.content.replace(/\s*$/, '') + '\n' + line + '\n');
  return true;
}

function removeIndexLine(indexPath: string, line: string): boolean {
  const cur = readFileSafe(indexPath);
  if (!cur.exists || !cur.content.includes(line)) return false;
  const kept = cur.content
    .split('\n')
    .filter((l) => l.trim() !== line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  atomicWriteFileSync(indexPath, kept.replace(/\s*$/, '') + '\n');
  return true;
}

// --- settings.json hook merge / remove (Claude Code hooks shape) ---

type HookGroup = { matcher?: string; hooks: Array<Record<string, unknown>> };

function mergeHook(
  settings: Record<string, any>,
  event: string,
  matcher: string,
  entry: Record<string, unknown>,
): Record<string, any> {
  const hooks = (settings.hooks ??= {});
  const groups: HookGroup[] = (hooks[event] ??= []);
  let group = groups.find((g) => g.matcher === matcher);
  if (!group) {
    group = { matcher, hooks: [] };
    groups.push(group);
  }
  const exists = group.hooks.some((h) => JSON.stringify(h) === JSON.stringify(entry));
  if (!exists) group.hooks.push(entry);
  return settings;
}

function removeHook(
  settings: Record<string, any>,
  event: string,
  matcher: string,
  entry: Record<string, unknown>,
): Record<string, any> {
  const groups: HookGroup[] | undefined = settings.hooks?.[event];
  if (!groups) return settings;
  const group = groups.find((g) => g.matcher === matcher);
  if (!group) return settings;
  group.hooks = group.hooks.filter((h) => JSON.stringify(h) !== JSON.stringify(entry));
  // Prune empty group / event / hooks object so undo leaves no residue.
  if (group.hooks.length === 0) {
    settings.hooks[event] = groups.filter((g) => g !== group);
  }
  if (Array.isArray(settings.hooks[event]) && settings.hooks[event].length === 0) {
    delete settings.hooks[event];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return settings;
}

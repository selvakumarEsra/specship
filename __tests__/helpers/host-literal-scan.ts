/**
 * Source scan for host literals in shared code (REQ-AGENTSWITCH-001.A1).
 *
 * A host literal is a string that only one coding agent understands. Shared
 * code must read these from the agent's profile instead. Comment lines are
 * skipped: they document behaviour and do not run.
 */
import * as fs from 'fs';
import * as path from 'path';

/** The literals the guard looks for, verbatim from the acceptance criterion. */
export const HOST_LITERALS = [
  'mcp__specship__',
  '.claude/',
  '.gemini/',
  'CLAUDE.md',
  'GEMINI.md',
  'UserPromptSubmit',
  'BeforeAgent',
  '~/.claude.json',
] as const;

/** Shared-code roots, relative to the repo root. */
export const SHARED_ROOTS = ['src', 'server/src'];

/**
 * The adapter layer: host specifics are allowed here, and only here.
 * A trailing `/` is a directory prefix; anything else is one file.
 */
export const ADAPTER_PATHS = [
  'src/installer/targets/',
  'src/workflows/agents/',
  'src/activation/hook-output.ts',
  'server/src/host-profiles.ts',
];

export interface HostLiteralHit {
  file: string;
  literal: string;
  line: number;
}

export interface AllowlistEntry {
  file: string;
  literal: string;
  /**
   * Exactly how many lines in the file carry the literal today. Pinned so a
   * NEW occurrence in an already-listed file fails the guard instead of
   * riding on the file's entry; removing one fails it too, so the count is
   * lowered (or the entry deleted) as leaks are fixed.
   */
  count: number;
  reason: string;
}

function isScanned(rel: string): boolean {
  if (rel.endsWith('.d.ts')) return false;
  if (rel.endsWith('.ts')) return true;
  return rel.startsWith('src/workflows/defaults/') && rel.endsWith('.yaml');
}

function isAdapter(rel: string): boolean {
  return ADAPTER_PATHS.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));
}

function isCommentLine(rel: string, line: string): boolean {
  const t = line.trim();
  if (rel.endsWith('.yaml')) return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function walk(root: string, dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, abs, out);
    else if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
}

/** Every host literal on a non-comment line of shared, non-adapter code under `repoRoot`. */
export function scanHostLiterals(repoRoot: string): HostLiteralHit[] {
  const files: string[] = [];
  for (const r of SHARED_ROOTS) walk(repoRoot, path.join(repoRoot, r), files);
  const hits: HostLiteralHit[] = [];
  for (const rel of files.sort()) {
    if (!isScanned(rel) || isAdapter(rel)) continue;
    const lines = fs.readFileSync(path.join(repoRoot, rel), 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (isCommentLine(rel, text)) return;
      for (const literal of HOST_LITERALS) {
        if (text.includes(literal)) hits.push({ file: rel, literal, line: i + 1 });
      }
    });
  }
  return hits;
}

/** Hits not covered by the allowlist, and allowlist entries that match nothing. */
export function checkAllowlist(
  hits: HostLiteralHit[],
  allowlist: readonly AllowlistEntry[],
): {
  unlisted: HostLiteralHit[];
  stale: AllowlistEntry[];
  miscounted: Array<{ entry: AllowlistEntry; actual: number }>;
} {
  const key = (f: string, l: string) => `${f}\u0000${l}`;
  const allowed = new Set(allowlist.map((e) => key(e.file, e.literal)));
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(key(h.file, h.literal), (counts.get(key(h.file, h.literal)) ?? 0) + 1);
  return {
    unlisted: hits.filter((h) => !allowed.has(key(h.file, h.literal))),
    stale: allowlist.filter((e) => !counts.has(key(e.file, e.literal))),
    miscounted: allowlist
      .map((entry) => ({ entry, actual: counts.get(key(entry.file, entry.literal)) ?? 0 }))
      .filter(({ entry, actual }) => actual > 0 && actual !== entry.count),
  };
}

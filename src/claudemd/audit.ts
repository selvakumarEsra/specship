/**
 * CLAUDE.md governance audit (CLAUDEMD-DOC).
 *
 * Deterministic structure/reference checks over a project's CLAUDE.md
 * hierarchy — root router + nested module files. Detection only: rewrites
 * are drafted in-session through the check door and human-gated
 * (REQ-CLAUDEMD-004); nothing in this module writes to a CLAUDE.md.
 *
 * Runs as a best-effort pass inside `sync()` (like the spec pass), guarded
 * by a fingerprint over the discovered files so the no-change case is a
 * cheap stat-walk (REQ-CLAUDEMD-001).
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeJsonAtomic, readJsonSafe } from '../statusline/paths';
import { getSpecShipDir } from '../directory';

export type ClaudeMdFindingKind =
  | 'missing-root'
  | 'root-too-long'
  | 'nested-too-long'
  | 'duplication'
  | 'stale-path'
  | 'module-candidate';

export interface ClaudeMdFinding {
  kind: ClaudeMdFindingKind;
  /** Project-relative path of the file (or directory) the finding is about. */
  file: string;
  detail: string;
}

export interface ClaudeMdAudit {
  v: 1;
  at: number;
  /** Fingerprint of the inputs that produced this audit (REQ-CLAUDEMD-001.A2). */
  hash: string;
  /** Project-relative paths of every CLAUDE.md discovered. */
  files: string[];
  findings: ClaudeMdFinding[];
}

/** Router bar for the root file; matches the claude-md-architect template. */
const ROOT_MAX_LINES = 200;
/** Cap for nested module files. */
const NESTED_MAX_LINES = 100;
/** Minimum trimmed length for a line to count toward duplication. */
const DUP_MIN_CHARS = 30;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.specship', '.claude', 'vendor', 'target', '__pycache__',
]);

/** Directory depth cap for discovery — CLAUDE.md nests are shallow by design. */
const MAX_DEPTH = 4;

function auditPath(projectRoot: string): string {
  return path.join(getSpecShipDir(projectRoot), 'claudemd-audit.json');
}

/**
 * Walk the tree (bounded depth, skip-list honored) collecting CLAUDE.md
 * files and per-directory package-manifest presence for the
 * module-candidate check. Never throws — unreadable dirs are skipped.
 */
function discover(projectRoot: string): {
  claudeMds: string[];
  manifestDirs: string[];
} {
  const claudeMds: string[] = [];
  const manifestDirs: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(abs, depth + 1);
      } else if (e.name === 'CLAUDE.md') {
        claudeMds.push(rel);
      } else if (depth > 0 && (e.name === 'package.json' || e.name === 'pyproject.toml' || e.name === 'Cargo.toml' || e.name === 'go.mod')) {
        manifestDirs.push(path.dirname(rel).split(path.sep).join('/'));
      }
    }
  };
  walk(projectRoot, 0);
  return { claudeMds: claudeMds.sort(), manifestDirs: [...new Set(manifestDirs)].sort() };
}

/** Cheap non-crypto fingerprint over discovery + file stats (FNV-1a). */
function fingerprint(projectRoot: string, claudeMds: string[], manifestDirs: string[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const rel of claudeMds) {
    mix(rel);
    try {
      const st = fs.statSync(path.join(projectRoot, rel));
      mix(`${st.size}:${st.mtimeMs}`);
    } catch {
      mix('gone');
    }
  }
  for (const d of manifestDirs) mix(`m:${d}`);
  return (h >>> 0).toString(16);
}

/**
 * Path-like tokens mentioned in a CLAUDE.md body: backticked or bare
 * repo-relative paths with at least one `/` and a known top-level prefix
 * feel. Query-string / URL / glob tokens are excluded — the check must
 * never flag an example that was not a path.
 */
function pathMentions(body: string): string[] {
  const out = new Set<string>();
  const re = /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const p = m[1]!;
    if (p.includes('://') || p.startsWith('@') || p.includes('*')) continue;
    // Require a file-ish tail or a known dir shape; skip bare two-word slashes
    // like `foo/bar` npm packages by requiring a dot in the tail OR a
    // conventional source prefix.
    const known = /^(src|scripts|docs|specs|server|ui|commands|agents|assets|packages|apps|__tests__|site|test|tests|lib)\//.test(p);
    if (known || /\.[a-z]{1,6}$/i.test(p)) out.add(p);
  }
  return [...out];
}

/** Trimmed lines that qualify for the duplication check. */
function dupCandidates(body: string): Set<string> {
  const set = new Set<string>();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length < DUP_MIN_CHARS) continue;
    if (/^#{1,6}\s/.test(line)) continue; // headings repeat legitimately
    if (/^[-*>|`]+$/.test(line)) continue;
    set.add(line);
  }
  return set;
}

/**
 * Run every deterministic check (REQ-CLAUDEMD-002) over the hierarchy.
 * Pure given the filesystem; never throws.
 */
export function auditClaudeMd(projectRoot: string): ClaudeMdAudit {
  const { claudeMds, manifestDirs } = discover(projectRoot);
  const findings: ClaudeMdFinding[] = [];
  const hash = fingerprint(projectRoot, claudeMds, manifestDirs);

  const bodies = new Map<string, string>();
  for (const rel of claudeMds) {
    try {
      bodies.set(rel, fs.readFileSync(path.join(projectRoot, rel), 'utf-8'));
    } catch {
      /* unreadable — skip its content checks (REQ-CLAUDEMD-001.A3) */
    }
  }

  const rootRel = claudeMds.find((p) => p === 'CLAUDE.md') ?? null;
  if (!rootRel) {
    findings.push({
      kind: 'missing-root',
      file: 'CLAUDE.md',
      detail: 'no root CLAUDE.md — sessions start without project grounding',
    });
  }

  // Size caps (root router bar / nested cap).
  for (const rel of claudeMds) {
    const body = bodies.get(rel);
    if (body === undefined) continue;
    const lines = body.split('\n').length;
    if (rel === rootRel && lines > ROOT_MAX_LINES) {
      findings.push({
        kind: 'root-too-long',
        file: rel,
        detail: `${lines} lines (router bar is ${ROOT_MAX_LINES}) — split module content into nested CLAUDE.md files`,
      });
    } else if (rel !== rootRel && lines > NESTED_MAX_LINES) {
      findings.push({
        kind: 'nested-too-long',
        file: rel,
        detail: `${lines} lines (nested cap is ${NESTED_MAX_LINES}) — extract to a referenced doc or push cross-cutting content to root`,
      });
    }
  }

  // Verbatim duplication root ↔ nested.
  if (rootRel) {
    const rootLines = dupCandidates(bodies.get(rootRel) ?? '');
    for (const rel of claudeMds) {
      if (rel === rootRel) continue;
      const body = bodies.get(rel);
      if (body === undefined) continue;
      for (const line of dupCandidates(body)) {
        if (rootLines.has(line)) {
          findings.push({
            kind: 'duplication',
            file: rel,
            detail: `duplicates root verbatim: "${line.slice(0, 60)}${line.length > 60 ? '…' : ''}" — nested files defer to root, never repeat it`,
          });
        }
      }
    }
  }

  // Stale path references.
  for (const rel of claudeMds) {
    const body = bodies.get(rel);
    if (body === undefined) continue;
    for (const p of pathMentions(body)) {
      if (!fs.existsSync(path.join(projectRoot, p))) {
        findings.push({
          kind: 'stale-path',
          file: rel,
          detail: `references \`${p}\`, which no longer exists`,
        });
      }
    }
  }

  // Module candidates: own manifest, no own CLAUDE.md (and none in a parent
  // BELOW root — root coverage alone is what makes it a candidate).
  const nestedDirs = new Set(
    claudeMds.filter((p) => p !== 'CLAUDE.md').map((p) => path.dirname(p).split(path.sep).join('/'))
  );
  for (const dir of manifestDirs) {
    const covered = [...nestedDirs].some((n) => dir === n || dir.startsWith(`${n}/`));
    if (!covered) {
      findings.push({
        kind: 'module-candidate',
        file: dir,
        detail: 'has its own package manifest but no CLAUDE.md — consider a nested file if it carries distinct invariants or verification',
      });
    }
  }

  return { v: 1, at: Date.now(), hash, files: claudeMds, findings };
}

/**
 * Sync-pass entry (REQ-CLAUDEMD-001): fingerprint-guarded, best-effort.
 * Returns the current audit (fresh or cached) or null on any failure.
 */
export function runClaudeMdAudit(projectRoot: string): ClaudeMdAudit | null {
  try {
    const stored = readJsonSafe<ClaudeMdAudit>(auditPath(projectRoot));
    const { claudeMds, manifestDirs } = discover(projectRoot);
    const hash = fingerprint(projectRoot, claudeMds, manifestDirs);
    if (stored?.v === 1 && stored.hash === hash) return stored;
    const audit = auditClaudeMd(projectRoot);
    writeJsonAtomic(auditPath(projectRoot), audit);
    return audit;
  } catch {
    return null; // a governance pass must never affect the sync
  }
}

/** Reader for surfacing (sync --drift-summary, check door, status). */
export function readClaudeMdAudit(projectRoot: string): ClaudeMdAudit | null {
  const a = readJsonSafe<ClaudeMdAudit>(auditPath(projectRoot));
  return a?.v === 1 ? a : null;
}

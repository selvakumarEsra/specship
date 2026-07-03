/**
 * Slug→path resolution for Claude Code project dirs (REQ-SLUGRES-001).
 *
 * Claude Code names `~/.claude/projects/<slug>` by replacing every character
 * outside [A-Za-z0-9] in the project's absolute path with '-'. The encoding
 * is lossy — '-', '/', '.', '_' all collapse into '-' — so decoding by
 * mapping '-' back to '/' mangles any real path containing those characters
 * (`/Users/a/dev/claude-projects/x` → `/Users/a/dev/claude/projects/x`).
 *
 * Real paths are recovered from authoritative local sources instead:
 *   1. `~/.claude.json` — its `projects` object is keyed by real absolute
 *      paths. We slug-encode each key into a reverse index.
 *   2. Transcript sniffing — JSONL lines carry a `"cwd"` field; a cwd (or
 *      one of its ancestors) whose encoding equals the slug is the real path.
 *   3. The legacy lossy decode, preserving behavior for hyphen-free paths.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decodeProjectSlug } from './ingestor.js';

export interface SlugResolverOptions {
  /** Override for tests. Defaults to `~/.claude.json`. */
  claudeJsonPath?: string;
  /** Override for tests. Defaults to `~/.claude/projects`. */
  claudeRoot?: string;
}

/** Claude Code's encoding: every char outside [A-Za-z0-9] becomes '-'. */
export function encodeProjectSlug(realPath: string): string {
  return realPath.replace(/[^A-Za-z0-9]/g, '-');
}

/** Max bytes read per transcript while sniffing for a cwd line. */
const SNIFF_BYTES = 64 * 1024;
/** Newest transcripts to try per slug before giving up. */
const SNIFF_FILES = 3;

interface ReverseIndexCache {
  mtimeMs: number;
  bySlug: Map<string, string>;
}

// Keyed by claudeJsonPath so tests with distinct temp files don't collide.
const indexCache = new Map<string, ReverseIndexCache>();

/**
 * Reverse index of slug → real path from `~/.claude.json`'s projects keys.
 * Cached per file and refreshed when the file's mtime changes. Any read or
 * parse failure yields an empty index (the caller falls through to sniffing).
 */
function claudeJsonIndex(claudeJsonPath: string): Map<string, string> {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(claudeJsonPath).mtimeMs;
  } catch {
    return new Map();
  }
  const cached = indexCache.get(claudeJsonPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.bySlug;

  const bySlug = new Map<string, string>();
  try {
    const parsed = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')) as {
      projects?: Record<string, unknown>;
    };
    for (const realPath of Object.keys(parsed.projects ?? {})) {
      bySlug.set(encodeProjectSlug(realPath), realPath);
    }
  } catch {
    /* malformed — serve the empty index, retry on next mtime change */
  }
  indexCache.set(claudeJsonPath, { mtimeMs, bySlug });
  return bySlug;
}

/**
 * Scan the newest transcripts in `<claudeRoot>/<slug>/` for a `"cwd"` whose
 * encoding matches the slug. Bounded read (first SNIFF_BYTES of up to
 * SNIFF_FILES files). Also accepts an ancestor of the cwd — sessions can
 * record a subdirectory cwd while the slug is for the project root.
 */
function sniffCwd(claudeRoot: string, slug: string): string | null {
  const dir = path.join(claudeRoot, slug);
  let files: Array<{ name: string; mtimeMs: number }>;
  try {
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.jsonl'))
      .map((f) => {
        try {
          return { name: f.name, mtimeMs: fs.statSync(path.join(dir, f.name)).mtimeMs };
        } catch {
          return { name: f.name, mtimeMs: 0 };
        }
      });
  } catch {
    return null;
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const cwdRe = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const f of files.slice(0, SNIFF_FILES)) {
    let chunk: string;
    try {
      const fd = fs.openSync(path.join(dir, f.name), 'r');
      try {
        const buf = Buffer.alloc(SNIFF_BYTES);
        const read = fs.readSync(fd, buf, 0, SNIFF_BYTES, 0);
        chunk = buf.toString('utf8', 0, read);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      continue;
    }
    cwdRe.lastIndex = 0;
    for (let m = cwdRe.exec(chunk); m; m = cwdRe.exec(chunk)) {
      let cwd: string;
      try {
        cwd = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        continue;
      }
      // Exact match, then walk up: a subdir cwd still identifies the root.
      for (let p = cwd; ; ) {
        if (encodeProjectSlug(p) === slug) return p;
        const parent = path.dirname(p);
        if (parent === p) break;
        p = parent;
      }
    }
  }
  return null;
}

/**
 * Build a resolver closure. Positive sniff results are memoized per slug so
 * per-request resolution stays cheap; the claude.json index refreshes on
 * mtime change (REQ-SLUGRES-001).
 */
export function createSlugResolver(opts: SlugResolverOptions = {}): (slug: string) => string {
  const claudeJsonPath = opts.claudeJsonPath ?? path.join(os.homedir(), '.claude.json');
  const claudeRoot = opts.claudeRoot ?? path.join(os.homedir(), '.claude', 'projects');
  const sniffed = new Map<string, string>();

  return (slug: string): string => {
    const fromIndex = claudeJsonIndex(claudeJsonPath).get(slug);
    if (fromIndex) return fromIndex;
    const cached = sniffed.get(slug);
    if (cached) return cached;
    const fromCwd = sniffCwd(claudeRoot, slug);
    if (fromCwd) {
      sniffed.set(slug, fromCwd);
      return fromCwd;
    }
    return decodeProjectSlug(slug);
  };
}

/** One-shot convenience for callers without a resolver to hold on to. */
export function resolveProjectSlug(slug: string, opts: SlugResolverOptions = {}): string {
  return createSlugResolver(opts)(slug);
}

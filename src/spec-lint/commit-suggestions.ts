/**
 * Link suggestions from a requirement's implementing commits (REQ-LINKACC-010).
 *
 * A commit whose message names a requirement (its id, or its JIRA key) changed
 * some symbols. Any of those the requirement does not link is a candidate the
 * author probably forgot. `specship lint` lists them as advisory suggestions —
 * nothing here writes a link or a spec file (A2).
 *
 * Bounded because lint runs on every invocation, CI included:
 *  - one `git log --no-merges` pass per project root, cached (merge commits are
 *    titled "merge REQ-X …" by the workflow and would match with a combined
 *    diff);
 *  - at most {@link MAX_COMMITS_PER_REQUIREMENT} most-recent matching commits
 *    per requirement;
 *  - a commit touching more than {@link MAX_FILES_PER_COMMIT} files (vendoring,
 *    a reformat) is skipped;
 *  - `git show` is memoised per sha for the life of the process.
 *
 * Any git failure — not a repository, no commits, git missing — yields no
 * commits and no error (A3).
 */

import { execFileSync } from 'child_process';
import { extractFromSource } from '../extraction/tree-sitter';
import { detectLanguage, isGrammarLoaded, isFileLevelOnlyLanguage, loadGrammarsForLanguages } from '../extraction/grammars';
import { isTestFile } from '../search/query-utils';
import type { Language, Node } from '../types';
import type { SpecLinkCandidate } from '../extraction/specs/types';
import type { LintFinding } from './lint';

export const MAX_COMMITS_PER_REQUIREMENT = 25;
export const MAX_FILES_PER_COMMIT = 200;

/** One commit that names a requirement, with the symbols it changed. */
export interface RequirementCommit {
  sha: string;
  message: string;
  changed: Array<{ filePath: string; symbol: string }>;
}

/**
 * Finds the commits whose messages name any of `needles` (a requirement id and
 * its JIRA key), newest first. Injected into `lintSpecs` so tests can fake git.
 */
export type RequirementCommitResolver = (needles: string[], projectRoot: string) => RequirementCommit[];

interface LoggedCommit {
  sha: string;
  message: string;
  files: string[];
}

const GIT_MAX_BUFFER = 256 * 1024 * 1024;

const logCache = new Map<string, LoggedCommit[]>();
const showCache = new Map<string, Array<{ filePath: string; ranges: Array<[number, number]> }>>();
const blobCache = new Map<string, Array<{ filePath: string; symbol: string }>>();

/** Drop the per-process git caches (tests that rewrite a repo use this). */
export function clearCommitSuggestionCaches(): void {
  logCache.clear();
  showCache.clear();
  blobCache.clear();
}

function git(projectRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: GIT_MAX_BUFFER,
    });
  } catch {
    return null;
  }
}

/**
 * Every non-merge commit with its message and changed file names, newest
 * first. One `git log` per project root, cached.
 */
function loggedCommits(projectRoot: string): LoggedCommit[] {
  const cached = logCache.get(projectRoot);
  if (cached) return cached;
  const out = git(projectRoot, ['log', '--no-merges', '--format=%x1e%H%x00%B%x00', '--name-only']);
  const commits: LoggedCommit[] = [];
  if (out) {
    for (const record of out.split('\x1e')) {
      if (!record.trim()) continue;
      const [sha, message, names] = record.split('\x00');
      if (!sha || !/^[0-9a-f]{7,64}$/.test(sha.trim())) continue;
      commits.push({
        sha: sha.trim(),
        message: message ?? '',
        files: (names ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
      });
    }
  }
  logCache.set(projectRoot, commits);
  return commits;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `message` names `needle` as a whole token: `REQ-LINKACC-01` does
 * not match `REQ-LINKACC-010`, and `SSHIP-82` does not match `SSHIP-828`.
 */
export function messageNames(message: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(needle)}(?![A-Za-z0-9_]|-[A-Za-z0-9])`).test(message);
}

/**
 * New-side line ranges of a `git show -U0` / `git diff -U0` patch, per file.
 * A pure deletion (`+N,0`) has no new-side lines and is dropped; a deleted
 * file (`+++ /dev/null`) contributes nothing.
 */
export function parseNewSideHunks(patch: string): Array<{ filePath: string; ranges: Array<[number, number]> }> {
  const out: Array<{ filePath: string; ranges: Array<[number, number]> }> = [];
  let current: { filePath: string; ranges: Array<[number, number]> } | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null') {
        current = null;
        continue;
      }
      current = { filePath: target.replace(/^b\//, ''), ranges: [] };
      out.push(current);
      continue;
    }
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m && current) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count > 0) current.ranges.push([start, start + count - 1]);
    }
  }
  return out.filter((f) => f.ranges.length > 0);
}

/** True for a path that can never be an implementation suggestion (A4). */
function isExcludedPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/');
  // Leading slash so a project-relative `__tests__/x.ts` hits isTestFile's
  // `/__tests__/` directory pattern.
  return norm.startsWith('specs/') || isTestFile(`/${norm.replace(/^\/+/, '')}`);
}

/** The language to parse a path with, or null when tree-sitter can't. */
function parseableLanguage(filePath: string): Language | null {
  const lang = detectLanguage(filePath);
  if (!lang || lang === 'unknown' || isFileLevelOnlyLanguage(lang)) return null;
  return lang;
}

/** Symbol kinds a spec can usefully link. Containers like `file`/`import` are not. */
const LINKABLE_KINDS = new Set<string>([
  'class', 'struct', 'interface', 'trait', 'protocol', 'function', 'method',
  'enum', 'type_alias', 'constant', 'variable', 'component', 'route', 'module', 'namespace',
]);

/**
 * The link name a node is addressed by in a spec: a method is `Class.method`
 * (a bare method name never resolves to a link), everything else its name.
 */
function linkName(node: Node, byId: Map<string, Node>, containerOf: Map<string, string>): string {
  if (node.kind !== 'method' && node.kind !== 'property' && node.kind !== 'field') return node.name;
  const parentId = containerOf.get(node.id);
  const parent = parentId ? byId.get(parentId) : undefined;
  return parent && parent.kind !== 'file' ? `${parent.name}.${node.name}` : node.name;
}

function changedSymbols(projectRoot: string, sha: string, filePath: string, ranges: Array<[number, number]>): Array<{ filePath: string; symbol: string }> {
  const lang = parseableLanguage(filePath);
  if (!lang || !isGrammarLoaded(lang)) return [];
  const source = git(projectRoot, ['show', `${sha}:${filePath}`]);
  if (source === null) return [];
  let nodes: Node[];
  let containerOf: Map<string, string>;
  try {
    const result = extractFromSource(filePath, source, lang);
    nodes = result.nodes;
    containerOf = new Map(result.edges.filter((e) => e.kind === 'contains').map((e) => [e.target, e.source]));
  } catch {
    return [];
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hit = nodes.filter(
    (n) => LINKABLE_KINDS.has(n.kind) && ranges.some(([a, b]) => n.startLine <= b && n.endLine >= a)
  );
  const out: Array<{ filePath: string; symbol: string }> = [];
  for (const node of hit) {
    // A container (a class) is the change only when some changed line is in it
    // but outside every changed symbol nested in it — a method edit suggests
    // `Class.method`, not the whole class.
    const nested = hit.filter((n) => n !== node && n.startLine >= node.startLine && n.endLine <= node.endLine && (n.startLine > node.startLine || n.endLine < node.endLine));
    if (nested.length > 0) {
      const ownLine = ranges.some(([a, b]) => {
        for (let l = Math.max(a, node.startLine); l <= Math.min(b, node.endLine); l++) {
          if (!nested.some((n) => l >= n.startLine && l <= n.endLine)) return true;
        }
        return false;
      });
      if (!ownLine) continue;
    }
    out.push({ filePath, symbol: linkName(node, byId, containerOf) });
  }
  return out;
}

/** Changed symbols of one commit, memoised per sha. */
function commitChanges(projectRoot: string, sha: string): Array<{ filePath: string; symbol: string }> {
  const key = `${projectRoot}\x00${sha}`;
  const cached = blobCache.get(key);
  if (cached) return cached;
  let hunks = showCache.get(key);
  if (!hunks) {
    const patch = git(projectRoot, ['show', '-U0', '--format=', '--no-renames', '--no-color', sha]);
    hunks = patch ? parseNewSideHunks(patch) : [];
    showCache.set(key, hunks);
  }
  const out: Array<{ filePath: string; symbol: string }> = [];
  for (const { filePath, ranges } of hunks) {
    if (isExcludedPath(filePath)) continue;
    out.push(...changedSymbols(projectRoot, sha, filePath, ranges));
  }
  blobCache.set(key, out);
  return out;
}

/**
 * Default {@link RequirementCommitResolver}: the newest
 * {@link MAX_COMMITS_PER_REQUIREMENT} non-merge commits whose message names a
 * needle, each with the symbols its changed lines fall in. Never throws.
 */
export function findRequirementCommits(needles: string[], projectRoot: string): RequirementCommit[] {
  const wanted = needles.filter(Boolean);
  if (wanted.length === 0) return [];
  const out: RequirementCommit[] = [];
  for (const c of loggedCommits(projectRoot)) {
    if (out.length >= MAX_COMMITS_PER_REQUIREMENT) break;
    if (!wanted.some((n) => messageNames(c.message, n))) continue;
    // Counted toward the cap even when skipped: the cap bounds work, and a
    // vendoring commit is still one of the requirement's commits.
    if (c.files.length > MAX_FILES_PER_COMMIT) {
      out.push({ sha: c.sha, message: c.message, changed: [] });
      continue;
    }
    out.push({ sha: c.sha, message: c.message, changed: commitChanges(projectRoot, c.sha) });
  }
  return out;
}

/**
 * Load the tree-sitter grammars for the languages touched by commits that name
 * any requirement-like id or JIRA key. `lintSpecs` is synchronous and parses
 * only with grammars already loaded, so the CLI awaits this first. Never throws.
 */
export async function preloadCommitGrammars(projectRoot: string): Promise<void> {
  try {
    const ID_LIKE = /\b[A-Z][A-Z0-9]*-[A-Z0-9-]*\d\b/;
    const langs = new Set<Language>();
    for (const c of loggedCommits(projectRoot)) {
      if (c.files.length > MAX_FILES_PER_COMMIT || !ID_LIKE.test(c.message)) continue;
      for (const f of c.files) {
        if (isExcludedPath(f)) continue;
        const lang = parseableLanguage(f);
        if (lang) langs.add(lang);
      }
    }
    if (langs.size > 0) await loadGrammarsForLanguages([...langs]);
  } catch {
    // Suggestions are advisory; a grammar that won't load just yields none.
  }
}

/** `path:Symbol` — the key a link and a suggestion are compared by. */
function linkKey(filePath: string, symbol: string): string {
  return `${filePath.replace(/\\/g, '/')}:${symbol}`;
}

/** The parse of one spec file that suggestions need. */
export interface SuggestionExtraction {
  specs: Array<{ id: string; kind: string; parentId?: string | null; startLine?: number; metadata?: unknown }>;
  linkCandidates: SpecLinkCandidate[];
}

/**
 * Suggestion findings for one spec file (REQ-LINKACC-010). For each
 * requirement: find its commits by id and JIRA key, collect the symbols they
 * changed, and drop those already linked by the requirement or its criteria,
 * and those linked by another requirement the same commit names. One finding
 * per remaining symbol, deduplicated and sorted. Pure apart from `resolver`.
 *
 * `corpusLinks` maps every requirement id in the corpus (criteria folded into
 * their requirement) to its linked `path:Symbol` keys; `corpusKeys` maps a
 * requirement id to its JIRA key, when it has one.
 */
export function linkSuggestionFindings(
  rel: string,
  extraction: SuggestionExtraction,
  corpusLinks: Map<string, Set<string>>,
  resolver: RequirementCommitResolver,
  projectRoot: string,
  corpusKeys: Map<string, string> = new Map()
): LintFinding[] {
  const doc = extraction.specs.find((s) => s.kind === 'document');
  const meta = ((doc?.metadata ?? {}) as Record<string, unknown>);
  const out: LintFinding[] = [];
  for (const req of extraction.specs.filter((s) => s.kind === 'requirement')) {
    const jira = meta[`jira_issue_${req.id}`];
    const needles = [req.id, ...(typeof jira === 'string' && jira.trim() ? [jira.trim()] : [])];
    let commits: RequirementCommit[];
    try {
      commits = resolver(needles, projectRoot);
    } catch {
      commits = [];
    }
    if (commits.length === 0) continue;

    const own = new Set<string>(corpusLinks.get(req.id) ?? []);
    for (const c of extraction.linkCandidates) {
      if (c.specId === req.id || c.specId.startsWith(`${req.id}.`)) own.add(linkKey(c.targetFilePath, c.targetQualifiedName));
    }

    const suggested = new Map<string, { sha: string; line?: number }>();
    for (const commit of commits) {
      // Symbols another requirement named in this same commit links are theirs.
      const others = new Set<string>();
      for (const [otherId, keys] of corpusLinks) {
        if (otherId === req.id) continue;
        const key = corpusKeys.get(otherId);
        if (messageNames(commit.message, otherId) || (key && messageNames(commit.message, key))) {
          for (const k of keys) others.add(k);
        }
      }
      for (const { filePath, symbol } of commit.changed) {
        if (isExcludedPath(filePath)) continue;
        const k = linkKey(filePath, symbol);
        if (own.has(k) || others.has(k) || suggested.has(k)) continue;
        suggested.set(k, { sha: commit.sha });
      }
    }
    for (const k of [...suggested.keys()].sort()) {
      out.push({
        code: 'spec_link_suggestion',
        severity: 'suggestion',
        filePath: rel,
        line: req.startLine,
        specId: req.id,
        message: `\`${k}\` changed in ${suggested.get(k)!.sha.slice(0, 7)} is not linked`,
      });
    }
  }
  return out;
}

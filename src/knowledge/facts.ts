/**
 * Read domain facts straight from disk (KNOWLEDGE-DOC).
 *
 * The knowledge commands (`stale`, `check`) are file-based: they must work on
 * a project that has never been indexed, so they read `specs/domain/**\/*.md`
 * and run each file through the real `MarkdownSpecExtractor` — the same parse
 * the indexer and the lint use, so all three agree on what a fact says.
 *
 * Read-only. Nothing in `src/knowledge/` writes to `specs/domain/`
 * (DOM-SPECSHIP-003: domain knowledge is human-confirmed, never auto-extracted).
 */

import * as fs from 'fs';
import * as path from 'path';
import { MarkdownSpecExtractor } from '../extraction/specs/markdown-spec-extractor';

export interface DomainFactFile {
  /** The fact's `DOM-<AREA>-NNN` id. */
  id: string;
  /** Project-relative, forward-slashed path of the fact file. */
  filePath: string;
  /** The fact's frontmatter `type` (term / rule / decision / constraint / external), when set. */
  type?: string;
  /** Frontmatter metadata (for an external fact: dependency, version, source, fixture). */
  metadata: Record<string, unknown>;
  /** Post-frontmatter prose. */
  body: string;
}

/** Recursively list `*.md` files under `dir` (sorted, forward-slashed, relative to `root`). */
function listMarkdown(dir: string, root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listMarkdown(full, root, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

/** Every addressable domain fact under `<projectRoot>/specs/domain/`, sorted by path. */
export function loadDomainFacts(projectRoot: string): DomainFactFile[] {
  const files: string[] = [];
  listMarkdown(path.join(projectRoot, 'specs', 'domain'), projectRoot, files);
  files.sort();
  const facts: DomainFactFile[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = fs.readFileSync(path.join(projectRoot, rel), 'utf8');
    } catch {
      continue;
    }
    const result = new MarkdownSpecExtractor(rel, source).extract();
    for (const spec of result.specs) {
      if (spec.kind !== 'domain') continue;
      const metadata = (spec.metadata ?? {}) as Record<string, unknown>;
      facts.push({
        id: spec.id,
        filePath: rel,
        type: typeof metadata.type === 'string' ? metadata.type : undefined,
        metadata,
        body: spec.body,
      });
    }
  }
  return facts;
}

/**
 * Split a `fixture:` frontmatter value into `path:Symbol` entries
 * (REQ-KNOW-006). The frontmatter parser is single-line `key: value` only (no
 * YAML lists), so several fixtures are written comma-separated; an optional
 * surrounding `[ ... ]` (YAML flow style) is tolerated.
 */
export function parseFixtureList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}

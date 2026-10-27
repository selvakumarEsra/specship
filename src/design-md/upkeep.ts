/**
 * Keeping design.md in step with the UI code (DESIGNMD-DOC, REQ-DESIGNMD-007).
 *
 * design.md is only worth trusting if it describes the UI that actually
 * ships. So a change that touches UI code governed by a design-backed spec
 * must, in the same change, record what moved in that spec's design.md: a new
 * Change log entry (and the authored sections it describes), or a
 * re-extraction when the design source itself changed. And the file must still
 * pass `specship design check`. `specship postcheck` runs this, which is what
 * makes `/specship:spec implement` refuse to finish without it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { checkDesignMd } from './check';

/** File types whose changes change what a user sees. */
export const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|styl)$/i;

export interface DesignBinding {
  /** Project-relative path of the spec file declaring `design:`. */
  specFile: string;
  /** Project-relative path of its design.md. */
  designFile: string;
  /** UI files the spec's `implementations:` blocks name. */
  uiFiles: string[];
}

export interface UpkeepFinding {
  designFile: string;
  message: string;
}

function rel(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).split(path.sep).join('/');
}

/** `design:` from a spec file's frontmatter, or null. */
export function designFrontmatter(source: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!fm) return null;
  const m = /^design:\s*(.+?)\s*$/m.exec(fm[1]!);
  return m ? m[1]!.replace(/^["']|["']$/g, '') : null;
}

/** Every file path named in the spec's `implementations:` blocks. */
function implementationFiles(source: string): string[] {
  const out = new Set<string>();
  let inBlock = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^implementations:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const m = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (m) {
      const bullet = m[1]!;
      const idx = bullet.lastIndexOf(':');
      out.add((idx > 0 && !/^[A-Za-z]:[\\/]/.test(bullet) ? bullet.slice(0, idx) : bullet).replace(/\\/g, '/'));
    } else if (line.trim() !== '') inBlock = false;
  }
  return [...out];
}

/** Every design-backed spec under specs/ with the UI files it governs. */
export function designBindings(projectRoot: string): DesignBinding[] {
  const out: DesignBinding[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && e.name !== 'design.md') {
        const source = fs.readFileSync(p, 'utf8');
        const design = designFrontmatter(source);
        if (!design) continue;
        out.push({
          specFile: rel(projectRoot, p),
          designFile: design.replace(/\\/g, '/'),
          uiFiles: implementationFiles(source).filter((f) => UI_FILE.test(f)),
        });
      }
    }
  };
  walk(path.join(projectRoot, 'specs'));
  return out;
}

function changeLog(content: string | null): string {
  if (content === null) return '';
  const start = content.search(/^## Change log[ \t]*$/m);
  return start === -1 ? '' : content.slice(start);
}

export interface UpkeepOptions {
  projectRoot: string;
  /** Files changed since the run base (project-relative). */
  changed: string[];
  /** The design.md content at the base ref, or null when it did not exist. */
  baseContent: (relPath: string) => string | null;
  /** The spec file of the requirement being implemented, when known. */
  specFile?: string | null;
}

/**
 * A design.md is "touched" by a change when the change edits a UI file its spec
 * governs, edits one of its recorded design sources, or edits any UI file while
 * implementing that design-backed spec itself.
 */
export function checkDesignUpkeep(opts: UpkeepOptions): { findings: UpkeepFinding[]; checked: string[] } {
  const changed = opts.changed.map((f) => f.replace(/\\/g, '/'));
  const changedUi = changed.filter((f) => UI_FILE.test(f) && !f.startsWith('specs/'));
  const ownSpec = opts.specFile ? rel(opts.projectRoot, path.resolve(opts.projectRoot, opts.specFile)) : null;
  const findings: UpkeepFinding[] = [];
  const checked: string[] = [];

  for (const b of designBindings(opts.projectRoot)) {
    const governed = new Set(b.uiFiles);
    const hits = changedUi.filter((f) => governed.has(f) || (b.specFile === ownSpec));
    if (hits.length === 0) continue;
    checked.push(b.designFile);

    const abs = path.resolve(opts.projectRoot, b.designFile);
    let now: string;
    try {
      now = fs.readFileSync(abs, 'utf8');
    } catch {
      findings.push({ designFile: b.designFile, message: `${b.specFile} names design: ${b.designFile}, which does not exist` });
      continue;
    }

    const shown = hits.slice(0, 5).join(', ') + (hits.length > 5 ? ` +${hits.length - 5} more` : '');
    if (changeLog(now) === changeLog(opts.baseContent(b.designFile))) {
      findings.push({
        designFile: b.designFile,
        message:
          `UI changed (${shown}) but ${b.designFile} has no new Change log entry — record what changed ` +
          '(update the authored sections it affects and add a dated Change log line naming the requirement; ' +
          'if the design source itself changed, run `specship design extract <sources> --update ' + b.designFile + '`)',
      });
    }
    for (const f of checkDesignMd(now, { projectRoot: opts.projectRoot })) {
      if (f.severity !== 'error') continue;
      findings.push({ designFile: b.designFile, message: `${b.designFile}${f.line ? `:${f.line}` : ''} ${f.code}: ${f.message}` });
    }
  }
  return { findings, checked };
}

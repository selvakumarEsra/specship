/**
 * Durable link assertions (THROUGHPUT-DOC, REQ-THRU-005).
 *
 * A link asserted through the link-assert tool lands as a DB row, and a DB row
 * alone vanishes on a full reindex. This module writes the same link into the
 * requirement's `implementations:` (kind `implements`) or `verifies:` (kind
 * `tests`) block in its spec file, so the parser re-asserts it on every index.
 *
 * Rules:
 *   - an acceptance-criterion id (`REQ-X.A1`) persists into its parent
 *     requirement's block — link blocks live under the requirement, never in
 *     the Acceptance section;
 *   - one bullet per target; a missing block is created right before the
 *     requirement's `## Acceptance` heading (or at the end of its prose);
 *   - idempotent — re-persisting a listed target leaves the file
 *     byte-identical;
 *   - a target with no symbol, or a symbol not defined in its file, is refused
 *     and the spec file is never touched.
 */

import * as fs from 'fs';
import * as path from 'path';
import { findSpecFile, linkBullets, requirementBlock } from './postcheck';

export type PersistLinkKind = 'implements' | 'tests';

export interface PersistLinkOptions {
  projectRoot: string;
  /** Requirement id (`REQ-X`) or acceptance-criterion id (`REQ-X.A1`). */
  specId: string;
  kind: PersistLinkKind;
  /** Project-relative path of the code/test file. */
  filePath: string;
  /** Symbol (qualified name or named test function) defined in `filePath`. */
  symbol: string;
  /**
   * Spec file to edit (project-relative or absolute). Default: the file under
   * `specs/` declaring the requirement's id marker.
   */
  specSourcePath?: string;
  /**
   * The caller already resolved `filePath:symbol` against the code graph —
   * skip the textual definition check (it is a fallback for callers without
   * a graph, and can miss syntax the extractor understands).
   */
  symbolResolved?: boolean;
}

export interface PersistLinkResult {
  status: 'persisted' | 'unchanged' | 'refused';
  /** Project-relative spec file path, when one was located. */
  specFile?: string;
  /** The requirement whose block was (or would have been) edited. */
  requirementId: string;
  /** Human-readable outcome / refusal reason. */
  detail: string;
}

const ID_MARKER = /^\s*<!--\s*id:\s*([A-Za-z0-9._-]+)\s*-->\s*$/;
const ACCEPTANCE_HEADING = /^#{1,6}\s+Acceptance\b/i;
const BULLET = /^\s+[-*]\s+\S/;

/** `REQ-X.A1` → `REQ-X`; a requirement id is returned unchanged. */
export function parentRequirementId(specId: string): string {
  return specId.replace(/\.A\d+$/, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Textual "is `symbol` defined in this source" check, in the style of the
 * postcheck verifies-coverage check, widened to qualified names
 * (`Class.method` → both the container and the member must be declared) and
 * class members / type declarations.
 */
export function symbolDefinedInSource(source: string, symbol: string): boolean {
  const parts = symbol.split(/\.|::|#/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part, i) => {
    const s = escapeRe(part);
    const decl = new RegExp(
      `\\b(function\\*?|const|let|var|class|interface|type|enum|struct|trait|def|fn|func)\\s+${s}\\b` +
        `|\\b${s}\\s*[:=]\\s*(async\\s+)?(function|\\()`,
    );
    if (decl.test(source)) return true;
    if (i === 0 && parts.length > 1) return false;
    // Class member: `  async name(` / `  public static name<T>(`.
    const member = new RegExp(
      `^\\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\\s+)*\\*?${s}\\s*(?:<[^>]*>)?\\s*\\(`,
      'm',
    );
    return member.test(source);
  });
}

/**
 * Persist an asserted link into the spec file. Never throws — failures and
 * refusals come back as `status: 'refused'` with the reason.
 */
export function persistLinkToSpecFile(opts: PersistLinkOptions): PersistLinkResult {
  const requirementId = parentRequirementId(opts.specId);
  const refuse = (detail: string, specFile?: string): PersistLinkResult => ({
    status: 'refused',
    requirementId,
    detail,
    ...(specFile ? { specFile } : {}),
  });

  const symbol = (opts.symbol ?? '').trim();
  const filePath = (opts.filePath ?? '').trim().replace(/\\/g, '/');
  if (!symbol) return refuse('target has no symbol — a link needs a `path:Symbol` target');
  if (!filePath) return refuse('target has no file path');
  if (opts.kind !== 'implements' && opts.kind !== 'tests') {
    return refuse(`kind "${String(opts.kind)}" has no spec-file block`);
  }

  const root = path.resolve(opts.projectRoot);
  const inRoot = (abs: string): boolean => {
    const rel = path.relative(root, abs);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };

  try {
    // 1. The target must be a resolvable `path:Symbol`.
    if (!opts.symbolResolved) {
      const targetAbs = path.resolve(root, filePath);
      if (!inRoot(targetAbs)) return refuse(`${filePath} resolves outside the project root`);
      let code: string;
      try {
        code = fs.readFileSync(targetAbs, 'utf8');
      } catch {
        return refuse(`${filePath} does not exist`);
      }
      if (!symbolDefinedInSource(code, symbol)) {
        return refuse(`${symbol} is not defined in ${filePath}`);
      }
    }

    // 2. Locate the spec file and the requirement's block.
    const specAbs = opts.specSourcePath
      ? path.resolve(root, opts.specSourcePath)
      : findSpecFile(root, requirementId);
    if (!specAbs) return refuse(`no spec file under specs/ declares ${requirementId}`);
    if (!inRoot(specAbs)) return refuse(`spec file resolves outside the project root`);
    const specFile = path.relative(root, specAbs).replace(/\\/g, '/');
    const source = fs.readFileSync(specAbs, 'utf8');
    const block = requirementBlock(source, requirementId);
    if (block === null) return refuse(`marker <!-- id: ${requirementId} --> not found`, specFile);

    const blockName = opts.kind === 'tests' ? 'verifies' : 'implementations';
    const target = `${filePath}:${symbol}`;
    if (linkBullets(block, blockName).includes(target)) {
      return {
        status: 'unchanged',
        requirementId,
        specFile,
        detail: `${blockName}: already lists ${target}`,
      };
    }

    // 3. Line-level edit inside the requirement's region.
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.split(/\r?\n/);
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const m = (lines[i] ?? '').match(ID_MARKER);
      if (!m) continue;
      if (start === -1) {
        if (m[1] === requirementId) start = i;
      } else if (!m[1]!.startsWith(`${requirementId}.`)) {
        end = i;
        break;
      }
    }
    if (start === -1) return refuse(`marker <!-- id: ${requirementId} --> not found`, specFile);

    const bullet = `  - ${target}`;
    const header = new RegExp(`^${blockName}:\\s*$`);
    let headerIdx = -1;
    for (let i = start + 1; i < end; i++) {
      if (header.test(lines[i] ?? '')) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx !== -1) {
      let last = headerIdx;
      for (let i = headerIdx + 1; i < end; i++) {
        const line = lines[i] ?? '';
        if (BULLET.test(line)) {
          last = i;
          continue;
        }
        if (line.trim() === '') continue;
        break;
      }
      lines.splice(last + 1, 0, bullet);
    } else {
      // Prose ends at `## Acceptance`, else at the first criterion marker,
      // else at the end of the region.
      let proseEnd = end;
      for (let i = start + 1; i < end; i++) {
        const line = lines[i] ?? '';
        const m = line.match(ID_MARKER);
        if (ACCEPTANCE_HEADING.test(line) || (m && m[1]!.startsWith(`${requirementId}.`))) {
          proseEnd = i;
          break;
        }
      }
      // An `implementations:` block goes before an existing `verifies:` one.
      if (blockName === 'implementations') {
        for (let i = start + 1; i < proseEnd; i++) {
          if (/^verifies:\s*$/.test(lines[i] ?? '')) {
            proseEnd = i;
            break;
          }
        }
      }
      let insertAt = proseEnd;
      while (insertAt > start + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
      const inserted = ['', `${blockName}:`, bullet];
      if (insertAt < lines.length) inserted.push('');
      // Collapse the blank line(s) we trimmed past so spacing stays single.
      let removeBlanks = 0;
      while (insertAt + removeBlanks < proseEnd && (lines[insertAt + removeBlanks] ?? '').trim() === '') {
        removeBlanks++;
      }
      lines.splice(insertAt, removeBlanks, ...inserted);
    }

    fs.writeFileSync(specAbs, lines.join(eol), 'utf8');
    return {
      status: 'persisted',
      requirementId,
      specFile,
      detail: `${blockName}: entry ${target} written to ${specFile}`,
    };
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err));
  }
}
